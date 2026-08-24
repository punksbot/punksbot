# Conserver l’exécution OS dans le client desktop

Les capacités qui exigent le filesystem, Git, ACP ou des sous-processus s’exécutent sur l’ordinateur du Punk au travers du client desktop natif. Le backend Workers authentifie, coordonne et synchronise ces opérations sans fournir de runtime serveur de repli, ce qui préserve les capacités desktop tout en maintenant la cible Workers managed-only.
