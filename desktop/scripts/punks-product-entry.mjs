/** Return true only for the explicit Punks product build. */
export function isPunksDistribution(environment) {
  return environment.VITE_PUNKS_DISTRIBUTION === "punks";
}

/**
 * Return the complete Punks document instead of mutating the Buzz document.
 * A complete replacement makes a future Buzz bootstrap addition fail closed:
 * it cannot leak into the Punks artifact through a missed string replacement.
 */
export function renderPunksIndexHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>Punks Bot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>`;
}
