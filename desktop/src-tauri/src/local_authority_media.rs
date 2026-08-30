use axum::{
    body::{Body, Bytes},
    extract::{Extension, Path},
    http::{header, HeaderMap, HeaderValue, Response, StatusCode},
    response::{IntoResponse, Json},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use image::{GenericImageView, ImageFormat};
use nostr::{Event, JsonUtil};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{io::Cursor, sync::Arc};

use super::{error_response, tag_value, LocalAuthority};

const MAX_LOCAL_UPLOAD_BYTES: usize = 100 * 1024 * 1024;
const THUMBNAIL_MAX_EDGE: u32 = 512;

struct ImageVariant {
    bytes: Vec<u8>,
    height: u32,
    sha256: String,
    thumbnail_height: u32,
    thumbnail_width: u32,
    width: u32,
}

enum VariantLookupError {
    Database(String),
    Invalid,
    NotFound,
}

pub(super) async fn upload(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response<Body> {
    if body.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "empty upload");
    }
    if body.len() > MAX_LOCAL_UPLOAD_BYTES {
        return error_response(StatusCode::PAYLOAD_TOO_LARGE, "upload exceeds local limit");
    }
    let sha256 = hex::encode(Sha256::digest(&body));
    if let Err(error) = authenticate_upload(&authority, &headers, &sha256) {
        return error_response(StatusCode::UNAUTHORIZED, &error);
    }
    if let Some(expected) = headers
        .get("x-sha-256")
        .and_then(|value| value.to_str().ok())
    {
        if !expected.eq_ignore_ascii_case(&sha256) {
            return error_response(StatusCode::BAD_REQUEST, "upload digest mismatch");
        }
    }
    let declared_mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("application/octet-stream")
        .to_string();
    let detected_mime = infer::get(&body)
        .map(|kind| kind.mime_type().to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    if detected_mime != "application/octet-stream" && declared_mime != detected_mime {
        return error_response(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "upload MIME does not match bytes",
        );
    }
    let mime_type = detected_mime;
    let image_variant = if mime_type.starts_with("image/") {
        let image_bytes = body.to_vec();
        match tokio::task::spawn_blocking(move || build_image_variant(&image_bytes)).await {
            Ok(Ok(variant)) => Some(variant),
            Ok(Err(error)) => return error_response(StatusCode::UNSUPPORTED_MEDIA_TYPE, &error),
            Err(error) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("join local image validation: {error}"),
                )
            }
        }
    } else {
        None
    };
    let media_path = authority.media_dir.join(&sha256);
    let already_stored = match store_immutable_blob(&authority, &sha256, &body).await {
        Ok(already_stored) => already_stored,
        Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let variant_already_stored = if let Some(variant) = &image_variant {
        match store_immutable_blob(&authority, &variant.sha256, &variant.bytes).await {
            Ok(already_stored) => already_stored,
            Err(error) => {
                if !already_stored {
                    let _ = tokio::fs::remove_file(&media_path).await;
                }
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error);
            }
        }
    } else {
        true
    };
    let uploaded = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let stored = authority
        .database
        .lock()
        .map_err(|error| error.to_string())
        .and_then(|mut db| {
            let transaction = db.transaction().map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO media(sha256, mime_type, size, uploaded)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(sha256) DO NOTHING",
                    rusqlite::params![sha256, mime_type, body.len() as i64, uploaded],
                )
                .map_err(|error| error.to_string())?;
            if let Some(variant) = &image_variant {
                transaction
                    .execute(
                        "INSERT INTO media_variants(
                           original_sha256, name, sha256, mime_type, size,
                           width, height, created_at
                         ) VALUES (?1, 'thumbnail', ?2, 'image/webp', ?3, ?4, ?5, ?6)
                         ON CONFLICT(original_sha256, name) DO UPDATE SET
                           sha256 = excluded.sha256,
                           mime_type = excluded.mime_type,
                           size = excluded.size,
                           width = excluded.width,
                           height = excluded.height",
                        rusqlite::params![
                            sha256,
                            variant.sha256,
                            variant.bytes.len() as i64,
                            variant.thumbnail_width,
                            variant.thumbnail_height,
                            uploaded,
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            transaction.commit().map_err(|error| error.to_string())
        });
    if let Err(error) = stored {
        if !already_stored {
            let _ = tokio::fs::remove_file(media_path).await;
        }
        if let Some(variant) = &image_variant {
            if !variant_already_stored {
                let _ = tokio::fs::remove_file(authority.media_dir.join(&variant.sha256)).await;
            }
        }
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("index local media: {error}"),
        );
    }
    let authority_header = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("127.0.0.1:18787");
    let dimensions = image_variant
        .as_ref()
        .map(|variant| format!("{}x{}", variant.width, variant.height));
    let thumbnail_url = image_variant
        .as_ref()
        .map(|_| format!("http://{authority_header}/media/{sha256}/variants/thumbnail"));
    Json(json!({
        "url": format!("http://{authority_header}/media/{sha256}"),
        "sha256": sha256,
        "size": body.len(),
        "type": mime_type,
        "uploaded": uploaded,
        "dim": dimensions,
        "blurhash": null,
        "thumb": thumbnail_url,
        "duration": null,
        "image": image_variant.as_ref().map(|variant| json!({
            "width": variant.width,
            "height": variant.height,
            "thumbnail": thumbnail_url
        }))
    }))
    .into_response()
}

fn build_image_variant(bytes: &[u8]) -> Result<ImageVariant, String> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| format!("decode quarantined image: {error}"))?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return Err("image dimensions are empty".to_string());
    }
    let thumbnail = if width <= THUMBNAIL_MAX_EDGE && height <= THUMBNAIL_MAX_EDGE {
        image
    } else {
        image.thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE)
    };
    let (thumbnail_width, thumbnail_height) = thumbnail.dimensions();
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, ImageFormat::WebP)
        .map_err(|error| format!("encode local image thumbnail: {error}"))?;
    let bytes = output.into_inner();
    let sha256 = hex::encode(Sha256::digest(&bytes));
    Ok(ImageVariant {
        bytes,
        height,
        sha256,
        thumbnail_height,
        thumbnail_width,
        width,
    })
}

async fn store_immutable_blob(
    authority: &LocalAuthority,
    sha256: &str,
    bytes: &[u8],
) -> Result<bool, String> {
    let path = authority.media_dir.join(sha256);
    let already_stored = path.exists();
    let quarantine = authority
        .media_dir
        .join(format!(".quarantine-{}", uuid::Uuid::new_v4()));
    tokio::fs::write(&quarantine, bytes)
        .await
        .map_err(|error| format!("write local media quarantine: {error}"))?;
    if already_stored {
        let _ = tokio::fs::remove_file(&quarantine).await;
        return Ok(true);
    }
    if let Err(error) = tokio::fs::rename(&quarantine, &path).await {
        let _ = tokio::fs::remove_file(&quarantine).await;
        return Err(format!("commit local media: {error}"));
    }
    Ok(false)
}

pub(super) async fn download(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    Path(sha256): Path<String>,
    headers: HeaderMap,
) -> Response<Body> {
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return error_response(StatusCode::BAD_REQUEST, "invalid media digest");
    }
    let metadata = authority
        .database
        .lock()
        .map_err(|error| error.to_string())
        .and_then(|db| {
            db.query_row(
                "SELECT mime_type, size FROM media WHERE sha256 = ?1",
                [&sha256],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(|error| error.to_string())
        });
    let Ok((mime_type, size)) = metadata else {
        return error_response(StatusCode::NOT_FOUND, "media not found");
    };
    let bytes = match tokio::fs::read(authority.media_dir.join(&sha256)).await {
        Ok(body) => body,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "media not found"),
    };
    let actual_size = usize::try_from(size.max(0))
        .unwrap_or_default()
        .min(bytes.len());
    let requested_range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    let range = match parse_range(requested_range, actual_size) {
        Ok(range) => range,
        Err(()) => return range_not_satisfiable(actual_size),
    };
    let (body, status, content_range) = match range {
        Some((start, end)) => (
            bytes[start..=end].to_vec(),
            StatusCode::PARTIAL_CONTENT,
            Some(format!("bytes {start}-{end}/{actual_size}")),
        ),
        None => (bytes, StatusCode::OK, None),
    };
    let content_length = body.len();
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    add_media_headers(
        &mut response,
        &mime_type,
        content_length,
        content_range.as_deref(),
    );
    response
}

pub(super) async fn head(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    Path(sha256): Path<String>,
) -> Response<Body> {
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return error_response(StatusCode::BAD_REQUEST, "invalid media digest");
    }
    let metadata = authority
        .database
        .lock()
        .map_err(|error| error.to_string())
        .and_then(|db| {
            db.query_row(
                "SELECT mime_type, size FROM media WHERE sha256 = ?1",
                [&sha256],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(|error| error.to_string())
        });
    let Ok((mime_type, size)) = metadata else {
        return error_response(StatusCode::NOT_FOUND, "media not found");
    };
    let mut response = Response::new(Body::empty());
    add_media_headers(
        &mut response,
        &mime_type,
        usize::try_from(size.max(0)).unwrap_or_default(),
        None,
    );
    response
}

pub(super) async fn download_variant(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    Path((sha256, variant)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response<Body> {
    let record = match variant_record(&authority, &sha256, &variant) {
        Ok(record) => record,
        Err(error) => return variant_error_response(error),
    };
    let bytes = match tokio::fs::read(authority.media_dir.join(&record.0)).await {
        Ok(bytes) => bytes,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "media variant not found"),
    };
    let size = usize::try_from(record.2.max(0))
        .unwrap_or_default()
        .min(bytes.len());
    let range = match parse_range(
        headers
            .get(header::RANGE)
            .and_then(|value| value.to_str().ok()),
        size,
    ) {
        Ok(range) => range,
        Err(()) => return range_not_satisfiable(size),
    };
    let (body, status, content_range) = match range {
        Some((start, end)) => (
            bytes[start..=end].to_vec(),
            StatusCode::PARTIAL_CONTENT,
            Some(format!("bytes {start}-{end}/{size}")),
        ),
        None => (bytes, StatusCode::OK, None),
    };
    let content_length = body.len();
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    add_media_headers(
        &mut response,
        &record.1,
        content_length,
        content_range.as_deref(),
    );
    response
}

pub(super) async fn head_variant(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    Path((sha256, variant)): Path<(String, String)>,
) -> Response<Body> {
    let record = match variant_record(&authority, &sha256, &variant) {
        Ok(record) => record,
        Err(error) => return variant_error_response(error),
    };
    let mut response = Response::new(Body::empty());
    add_media_headers(
        &mut response,
        &record.1,
        usize::try_from(record.2.max(0)).unwrap_or_default(),
        None,
    );
    response
}

fn variant_record(
    authority: &LocalAuthority,
    original_sha256: &str,
    variant: &str,
) -> Result<(String, String, i64), VariantLookupError> {
    if original_sha256.len() != 64
        || !original_sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        || variant != "thumbnail"
    {
        return Err(VariantLookupError::Invalid);
    }
    authority
        .database
        .lock()
        .map_err(|error| VariantLookupError::Database(error.to_string()))?
        .query_row(
            "SELECT sha256, mime_type, size FROM media_variants
             WHERE original_sha256 = ?1 AND name = ?2",
            rusqlite::params![original_sha256, variant],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| VariantLookupError::NotFound)
}

fn variant_error_response(error: VariantLookupError) -> Response<Body> {
    match error {
        VariantLookupError::Database(error) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("read media variant: {error}"),
        ),
        VariantLookupError::Invalid => {
            error_response(StatusCode::BAD_REQUEST, "invalid media variant")
        }
        VariantLookupError::NotFound => {
            error_response(StatusCode::NOT_FOUND, "media variant not found")
        }
    }
}

fn authenticate_upload(
    authority: &LocalAuthority,
    headers: &HeaderMap,
    sha256: &str,
) -> Result<(), String> {
    let encoded = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Nostr "))
        .ok_or_else(|| "missing Blossom upload authorization".to_string())?;
    let raw = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "invalid Blossom upload authorization encoding".to_string())?;
    let event = Event::from_json(raw)
        .map_err(|_| "invalid Blossom upload authorization event".to_string())?;
    if event.kind.as_u16() as u32 != 24_242 || !event.verify_id() || !event.verify_signature() {
        return Err("invalid Blossom upload authorization signature".to_string());
    }
    if tag_value(&event, "t").as_deref() != Some("upload")
        || tag_value(&event, "x").as_deref() != Some(sha256)
    {
        return Err("Blossom upload authorization does not match blob".to_string());
    }
    let now = chrono::Utc::now().timestamp();
    let expiration = tag_value(&event, "expiration")
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(|| "Blossom upload authorization has no expiration".to_string())?;
    if expiration <= now || expiration > now + 3_600 {
        return Err("Blossom upload authorization is expired or too long".to_string());
    }
    if let Some(expected_server) = tag_value(&event, "server") {
        let request_server = headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("127.0.0.1:18787");
        if !expected_server.eq_ignore_ascii_case(request_server) {
            return Err("Blossom upload authorization targets another server".to_string());
        }
    }
    authority.assert_member_can_publish(&event.pubkey.to_hex())
}

fn parse_range(header: Option<&str>, size: usize) -> Result<Option<(usize, usize)>, ()> {
    let Some(header) = header else {
        return Ok(None);
    };
    let raw = header.strip_prefix("bytes=").ok_or(())?;
    if raw.contains(',') || size == 0 {
        return Err(());
    }
    let (start, end) = raw.split_once('-').ok_or(())?;
    if start.is_empty() {
        let suffix = end.parse::<usize>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        return Ok(Some((size.saturating_sub(suffix.min(size)), size - 1)));
    }
    let start = start.parse::<usize>().map_err(|_| ())?;
    if start >= size {
        return Err(());
    }
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<usize>().map_err(|_| ())?.min(size - 1)
    };
    if start > end {
        return Err(());
    }
    Ok(Some((start, end)))
}

fn add_media_headers(
    response: &mut Response<Body>,
    mime_type: &str,
    content_length: usize,
    content_range: Option<&str>,
) {
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&content_length.to_string())
            .unwrap_or_else(|_| HeaderValue::from_static("0")),
    );
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    if let Some(content_range) = content_range.and_then(|value| HeaderValue::from_str(value).ok()) {
        response
            .headers_mut()
            .insert(header::CONTENT_RANGE, content_range);
    }
}

fn range_not_satisfiable(size: usize) -> Response<Body> {
    let mut response = error_response(StatusCode::RANGE_NOT_SATISFIABLE, "invalid media range");
    if let Ok(value) = HeaderValue::from_str(&format!("bytes */{size}")) {
        response.headers_mut().insert(header::CONTENT_RANGE, value);
    }
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response
}
