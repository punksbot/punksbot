# Effacer le contenu sans réécrire le journal

Le contenu susceptible d’être supprimé est chiffré séparément des métadonnées attestées avec une clé révocable. Une suppression détruit la clé et les projections lisibles, puis ajoute un Marqueur d’effacement ; les segments scellés peuvent conserver le ciphertext devenu inutilisable ainsi que la preuve minimale de l’opération. Le journal et sa chaîne d’empreintes ne sont jamais réécrits.
