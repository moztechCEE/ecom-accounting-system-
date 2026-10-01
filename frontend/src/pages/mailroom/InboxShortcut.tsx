import { useEffect, useState } from "react";
import { Badge, Button } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import { webSocketService } from "../../services/websocket.service";
import { mailroomEnabled } from "./model";
export default function InboxShortcut() {
  const [count, setCount] = useState(0);
  const navigate = useNavigate();
  const enabled = mailroomEnabled();
  const entityId = localStorage.getItem("entityId") || "";
  useEffect(() => {
    let alive = true;
    if (!enabled || !entityId) return;
    const refresh = () =>
      api
        .get("/mailroom/tasks", { params: { entityId } })
        .then((r) => {
          if (alive) setCount(r.data.length);
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    const unsubscribe = webSocketService.subscribe((n) => {
      if (n.category === "mailroom") void refresh();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [enabled, entityId]);
  return enabled ? (
    <Badge count={count} size="small">
      <Button icon={<InboxOutlined />} onClick={() => navigate("/my/inbox")}>
        我的待辦
      </Button>
    </Badge>
  ) : null;
}
