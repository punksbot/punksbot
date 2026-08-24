# Archiver les segments scellés du journal dans R2

Le Durable Object autoritaire conserve l’état courant, les curseurs récents et le manifeste du journal de son agrégat. Les anciens événements sont regroupés en segments immuables, signés et chaînés par empreinte avant archivage dans R2 ; ils ne quittent le stockage chaud qu’après vérification de leur intégrité et inscription du segment dans le manifeste. L’ensemble état courant, manifeste et segments permet une reconstruction vérifiable.
