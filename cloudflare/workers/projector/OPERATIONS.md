# Projector attestation registry

`ATTESTATION_PUBLIC_KEYS_JSON` is a required runtime binding. It contains only
public x-only Schnorr keys and is intentionally absent from `wrangler.jsonc`
until the real staging attestation public key is known. A missing or malformed
binding fails closed: Bot and Bot Installation Queue messages are retried and
never acknowledged or written to D1.

The exact JSON shape is an environment map, then a key-version map:

```json
{
  "staging": {
    "<key-version>": "<64 lowercase hexadecimal x-only public key>"
  }
}
```

Before the first staging deployment, derive the public key from the existing
Attestation Worker key out of band, verify its version and environment, then
provision the complete JSON value as the Worker binding. Never place a private
key, a placeholder public key, or a production value in the repository.

After provisioning, run the Projector check and staging dry-run. The dry-run is
allowed to build without the binding because it performs no Queue consumption;
the deployed runtime remains fail-closed until the binding exists.
