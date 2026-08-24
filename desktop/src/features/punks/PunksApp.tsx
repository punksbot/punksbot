import { createTauriPunksAccountClient } from "@/shared/api/punksClient";
import { useState } from "react";

import { PunksRuntime } from "./PunksRuntime";

/** Entry point for the product Punks distribution. */
export default function PunksApp() {
  const [client] = useState(createTauriPunksAccountClient);
  return <PunksRuntime client={client} />;
}
