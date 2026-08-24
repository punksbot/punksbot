# Transporter les Huddles avec Cloudflare Realtime

Cloudflare Realtime SFU transporte les pistes WebRTC, tandis qu’un Durable Object autoritaire par Huddle gère la présence, les permissions, les sessions et les identifiants de pistes. Les enregistrements finalisés, lorsqu’ils existent, sont stockés dans R2 plutôt que dans le Durable Object.
