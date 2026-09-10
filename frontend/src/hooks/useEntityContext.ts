import { useEffect, useState } from "react";
export function useEntityContext() {
  const read = () => localStorage.getItem("entityId")?.trim() || "";
  const [entityId, setEntityId] = useState(read);
  useEffect(() => {
    const sync = () => setEntityId(read());
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  return entityId;
}
