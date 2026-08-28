# Détecter un Compte Punks par e-mail sans le fusionner automatiquement

Un e-mail vérifié et normalisé peut signaler qu’un Compte Punks existe déjà, mais ne suffit jamais à y rattacher un nouveau fournisseur. Le Punk doit se réauthentifier avec un moyen déjà lié avant d’ajouter Google ou GitHub, seuls moyens conservés par [l’ADR 0064](0064-limiter-la-connexion-a-google-et-github.md). Cette preuve explicite évite qu’une collision ou une réattribution d’e-mail fusionne silencieusement deux identités.
