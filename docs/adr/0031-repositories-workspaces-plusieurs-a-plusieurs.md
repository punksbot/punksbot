# Relier Repositories et Workspaces en plusieurs-à-plusieurs

Un Workspace peut posséder plusieurs Connexions de Repository et un même Repository GitHub peut être connecté à plusieurs Workspaces. Chaque connexion conserve ses propres capacités, visibilité, curseurs et projections ; un webhook GitHub est ingéré une fois puis distribué idempotemment à toutes les connexions concernées. Aucune connexion ne duplique ni ne devient propriétaire des objets Git.
