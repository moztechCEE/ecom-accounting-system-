import { useEffect, useState } from "react";
import { Select } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import { listEntities, type Entity } from "../services/entities.service";
import { useAuth } from "../contexts/AuthContext";
export default function OperationsCompanySelector({
  entityId,
}: {
  entityId: string;
}) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [options, setOptions] = useState<{ actor: string; rows: Entity[] }>();
  useEffect(() => {
    let active = true;
    if (!user?.id) return;
    const actor = user.id;
    listEntities({ isActive: true })
      .then((rows) => {
        if (active) setOptions({ actor, rows });
      })
      .catch(() => {
        if (active) setOptions({ actor, rows: [] });
      });
    return () => {
      active = false;
    };
  }, [user?.id]);
  const rows = options && options.actor === user?.id ? options.rows : [];
  const select = (value: string) => {
    const params = new URLSearchParams(location.search);
    params.set("entityId", value);
    navigate(location.pathname + "?" + params.toString());
  };
  return (
    <Select
      aria-label="公司"
      placeholder="選擇公司"
      value={entityId || undefined}
      style={{ minWidth: 180, maxWidth: 280 }}
      onChange={select}
      options={rows.map((row) => ({ value: row.id, label: row.name }))}
    />
  );
}
