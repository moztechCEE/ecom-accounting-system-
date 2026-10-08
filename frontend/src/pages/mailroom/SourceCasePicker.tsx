import { useEffect, useRef, useState } from "react";
import { Alert, Button, Empty, Select, Spin, Tag, Typography } from "antd";
import dayjs from "dayjs";
import api from "../../services/api";
import { CATEGORIES, errorText, type Source } from "./model";
import { mergeSourcePages, sourceSearchRequests } from "./source-search";

type Page = { items: Source[]; nextCursor?: string | null };
type Props = {
  id?: string;
  value?: string;
  onChange?: (id: string) => void;
  entityId: string;
  active: boolean;
  selectedSource?: Source;
  onSelectSource: (source: Source) => void;
};

export default function SourceCasePicker({
  id,
  value,
  onChange,
  entityId,
  active,
  selectedSource,
  onSelectSource,
}: Props) {
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const requests = useRef(sourceSearchRequests());

  useEffect(() => {
    if (!active) {
      requests.current.cancel();
      setDropdownOpen(false);
      setQuery("");
      setSources([]);
      setCursor(null);
      setLoading(false);
      setMoreBusy(false);
      return;
    }
    const request = requests.current.begin();
    setLoading(true);
    setMoreBusy(false);
    setFailure("");
    setSources([]);
    setCursor(null);
    const timer = setTimeout(
      async () => {
        try {
          const result = await api.get<Page>("/mailroom/source-cases", {
            params: { entityId, search: query.trim() },
            signal: request.signal,
          });
          if (!request.isCurrent()) return;
          setSources(result.data.items);
          setCursor(result.data.nextCursor || null);
        } catch (error) {
          if (request.isCurrent()) setFailure(errorText(error));
        } finally {
          if (request.isCurrent()) setLoading(false);
        }
      },
      query.trim() ? 300 : 0,
    );
    return () => {
      clearTimeout(timer);
      requests.current.cancel();
    };
  }, [active, entityId, query, refresh]);

  async function loadMore() {
    if (!cursor || loading || moreBusy) return;
    const request = requests.current.begin();
    setMoreBusy(true);
    setFailure("");
    try {
      const result = await api.get<Page>("/mailroom/source-cases", {
        params: { entityId, search: query.trim(), cursor },
        signal: request.signal,
      });
      if (!request.isCurrent()) return;
      setSources((previous) => mergeSourcePages(previous, result.data.items));
      setCursor(result.data.nextCursor || null);
    } catch (error) {
      if (request.isCurrent()) setFailure(errorText(error));
    } finally {
      if (request.isCurrent()) setMoreBusy(false);
    }
  }

  function recent() {
    requests.current.cancel();
    setQuery("");
    setRefresh((previous) => previous + 1);
    setDropdownOpen(true);
  }

  return (
    <div className="mailroom-source-search">
      <div className="mailroom-source-controls">
        <Select
          id={id}
          className="mailroom-source-select"
          aria-label="搜尋售後案件"
          placeholder="案件、入件單號、電話、姓名或產品"
          showSearch
          filterOption={false}
          searchValue={query}
          value={value}
          open={dropdownOpen}
          onOpenChange={setDropdownOpen}
          loading={loading}
          autoClearSearchValue={false}
          onSearch={(text) => {
            if (text.slice(0, 100) === query) return;
            requests.current.cancel();
            setQuery(text.slice(0, 100));
          }}
          onChange={(sourceId) => {
            const source = sources.find((item) => item.id === sourceId);
            if (!source) return;
            onChange?.(sourceId);
            onSelectSource(source);
            setDropdownOpen(false);
            setQuery("");
          }}
          labelRender={({ label }) =>
            selectedSource && selectedSource.id === value
              ? `${selectedSource.number} · ${selectedSource.customerLabel}`
              : label
          }
          options={sources.map((source) => ({
            value: source.id,
            label: `${source.number} · ${source.customerLabel}`,
            source,
          }))}
          optionRender={({ data }) => (
            <div className="mailroom-source-option">
              <div>
                <strong>{data.source.number}</strong>
                <Tag>{CATEGORIES[data.source.type]}</Tag>
              </div>
              <Typography.Text type="secondary">
                {data.source.customerLabel}{data.source.customerPhone ? ` · ${data.source.customerPhone}` : ""}
              </Typography.Text>
              {data.source.version && (
                <Typography.Text
                  className="mailroom-source-date"
                  type="secondary"
                >
                  更新 {dayjs(data.source.version).format("MM/DD HH:mm")}
                </Typography.Text>
              )}
            </div>
          )}
          notFoundContent={
            loading ? (
              <Spin size="small" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  failure
                    ? "案件暫時無法載入"
                    : query.trim()
                      ? "沒有符合的案件"
                      : "目前沒有可選案件"
                }
              />
            )
          }
          popupRender={(menu) => (
            <>
              {menu}
              {cursor && (
                <div className="mailroom-source-more">
                  <Button
                    block
                    type="link"
                    loading={moreBusy}
                    disabled={loading}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void loadMore()}
                  >
                    載入更多較早案件
                  </Button>
                </div>
              )}
            </>
          )}
        />
        <Button className="mailroom-source-recent" onClick={recent}>
          最近案件
        </Button>
      </div>
      {failure && (
        <Alert
          type="warning"
          showIcon
          message="售後案件搜尋暫時無法更新"
          description={failure}
          action={
            <Button size="small" onClick={recent}>
              重試
            </Button>
          }
        />
      )}
    </div>
  );
}
