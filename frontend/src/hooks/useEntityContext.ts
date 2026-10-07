import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

function storedEntityId() {
  try { return localStorage.getItem("entityId")?.trim() || ""; }
  catch { return ""; }
}

export function useEntityContext() {
  const { search } = useLocation();
  const explicitEntityId = new URLSearchParams(search).get("entityId")?.trim();
  const [fallbackEntityId, setFallbackEntityId] = useState(storedEntityId);
  useEffect(() => {
    const sync = () => setFallbackEntityId(storedEntityId());
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  return explicitEntityId || fallbackEntityId;
}
