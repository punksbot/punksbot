use std::io::Cursor;

use image::{DynamicImage, GenericImageView, ImageFormat};

use super::*;

#[tokio::test]
async fn image_upload_persists_dimensions_and_an_immutable_webp_thumbnail() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed image owner");
    let mut png = Cursor::new(Vec::new());
    DynamicImage::new_rgba8(2, 1)
        .write_to(&mut png, ImageFormat::Png)
        .expect("encode proof PNG");
    let payload = png.into_inner();
    let sha256 = hex::encode(Sha256::digest(&payload));
    let router = authority_router(Arc::new(authority.clone()));
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/upload")
                .header("host", "127.0.0.1:18787")
                .header("content-type", "image/png")
                .header("authorization", blossom_upload_header(&owner, &sha256))
                .body(Body::from(payload))
                .expect("image upload request"),
        )
        .await
        .expect("image upload response");
    assert_eq!(response.status(), StatusCode::OK);
    let response: Value = serde_json::from_slice(
        &to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("image upload body"),
    )
    .expect("image upload JSON");
    assert_eq!(response["dim"], "2x1");
    let thumbnail_url = response["thumb"].as_str().expect("thumbnail URL");
    let thumbnail_path = url::Url::parse(thumbnail_url)
        .expect("thumbnail URL syntax")
        .path()
        .to_string();
    let thumbnail = router
        .oneshot(
            Request::builder()
                .uri(&thumbnail_path)
                .body(Body::empty())
                .expect("thumbnail request"),
        )
        .await
        .expect("thumbnail response");
    assert_eq!(thumbnail.status(), StatusCode::OK);
    assert_eq!(thumbnail.headers()["content-type"], "image/webp");
    let thumbnail = to_bytes(thumbnail.into_body(), 1024 * 1024)
        .await
        .expect("thumbnail bytes");
    assert_eq!(
        image::load_from_memory(&thumbnail)
            .expect("decode thumbnail")
            .dimensions(),
        (2, 1)
    );
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen image authority");
    let persisted = authority_router(Arc::new(reopened))
        .oneshot(
            Request::builder()
                .uri(thumbnail_path)
                .body(Body::empty())
                .expect("persisted thumbnail request"),
        )
        .await
        .expect("persisted thumbnail response");
    assert_eq!(persisted.status(), StatusCode::OK);
    assert_eq!(persisted.headers()["content-type"], "image/webp");
}
