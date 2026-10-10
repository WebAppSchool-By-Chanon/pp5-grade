"use client";

import { Loader2, Printer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveCoverPeriod, type CoverPeriod } from "@/lib/pp5-cover-period";

// Section keys — mirrors `/reports/pp5-class` page.tsx `resolveParts`.
const SECTION_KEYS = [
  "cover",
  "attendance",
  "scores",
  "characteristics",
  "reading",
  "competency",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const SECTION_LABEL: Record<SectionKey, string> = {
  cover: "หน้าปก",
  attendance: "เวลาเรียน",
  scores: "ผลการเรียน",
  characteristics: "คุณลักษณะอันพึงประสงค์",
  reading: "อ่าน คิดวิเคราะห์ เขียน",
  competency: "สมรรถนะสำคัญ",
};

export type ClassroomOption = {
  id: string;
  label: string;
  grade_id: string;
  grade_label: string;
  grade_sort: number;
  is_primary: boolean;
};

type Props = {
  classrooms: ClassroomOption[];
  currentSemester?: number;
};

// 210mm at 96dpi ≈ 793px — A4 portrait paper box width.
const PAPER_WIDTH_PX = 793;

/**
 * Split-layout selector for /reports/pp5-class — mirrors the UX of
 * pp5-selector-form.tsx (per-subject), simplified for the per-classroom
 * report:
 *   - No subject dropdown (the bundle covers all subjects in the class)
 *   - 6 section toggles instead of 7
 *   - URL points to /reports/pp5-class
 *
 * Per user spec 2026-05-19 ("หน้าต่างเมื่อเข้าเมนูให้ทำแบบ ปพ.5 รายวิชา"):
 * inherits the same wrapper + container-query layout from pp5-selector-form,
 * including the narrow-screen tab switcher + auto-fit zoom dropdown.
 */
export function Pp5ClassSelectorForm({ classrooms, currentSemester = 1 }: Props) {
  // ───────── Selectors ─────────
  const grades = useMemo(() => {
    const seen = new Map<
      string,
      { id: string; label: string; sort: number }
    >();
    for (const c of classrooms) {
      if (!seen.has(c.grade_id)) {
        seen.set(c.grade_id, {
          id: c.grade_id,
          label: c.grade_label,
          sort: c.grade_sort,
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.sort - b.sort);
  }, [classrooms]);

  // Start with NO grade selected so the preview doesn't auto-load the
  // first grade (ป.1) on entry — admin must pick a ระดับชั้น first.
  // User spec 2026-05-31: "เมื่อเข้ามาจะแสดง ป.1 ทันที ให้แก้ใหม่คือ
  // ให้เลือกชั้นก่อนค่อยแสดง".
  const [gradeId, setGradeId] = useState<string>("");

  const rooms = useMemo(
    () => classrooms.filter((c) => c.grade_id === gradeId),
    [classrooms, gradeId],
  );
  // Start empty so the preview doesn't auto-show on page load — user
  // spec 2026-05-20: "อย่าพึ่งแสดงพรีวิวก่อน ให้ผู้ใช้เลือกห้องก่อน".
  const [roomId, setRoomId] = useState<string>("");

  // Auto-select when the current grade has only one room — there's
  // nothing to pick, so the explicit selection requirement is just
  // extra clicks. The dropdown is also hidden in this case (see JSX
  // below). User spec 2026-05-20: "ชั้นที่มีห้องเดียว ไม่ต้องให้เลือกห้องอีก".
  useEffect(() => {
    if (rooms.length === 1 && roomId !== rooms[0].id) {
      setRoomId(rooms[0].id);
    }
  }, [rooms, roomId]);

  // No fallback to rooms[0] — only show preview when user has explicitly
  // picked a room (or the auto-select above resolved a single-room grade).
  const selectedRoom = rooms.find((r) => r.id === roomId) ?? null;
  const [coverPeriodChoice, setCoverPeriodChoice] = useState<CoverPeriod | undefined>();
  const coverPeriod = resolveCoverPeriod(coverPeriodChoice, selectedRoom?.is_primary ?? false, currentSemester);

  // Section toggles
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({
    cover: true,
    attendance: true,
    scores: true,
    characteristics: true,
    reading: true,
    competency: true,
  });
  const enabledSections = SECTION_KEYS.filter((k) => sections[k]);
  const partsParam = enabledSections.join(",");
  const allEnabled = enabledSections.length === SECTION_KEYS.length;

  const canPreview = !!(selectedRoom && enabledSections.length > 0);
  const previewSrc = canPreview
    ? `/reports/pp5-class?classroom=${selectedRoom!.id}&embed=1&cover_period=${coverPeriod}${
        allEnabled ? "" : `&parts=${partsParam}`
      }`
    : null;

  // Debounce iframe src updates so rapid toggle changes don't trigger
  // N reloads — wait 250ms after last change.
  const [iframeSrc, setIframeSrc] = useState<string | null>(previewSrc);
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    if (previewSrc === iframeSrc) return;
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIframeSrc(previewSrc);
    }, 250);
    return () => clearTimeout(timer);
  }, [previewSrc, iframeSrc]);

  // Narrow-screen tab switcher (CSS container query in globals.css flips
  // the layout single-column when the wrapper is < 900px wide).
  const [tabView, setTabView] = useState<"config" | "preview">("config");

  // Auto-jump to preview tab as soon as a room is selected (in per-subject
  // form this triggered on subjectId; here we use roomId since there's no
  // subject step). Saves an extra tap on narrow screens. When the user
  // clears the room (e.g. by switching grade), flip back to the config
  // tab — there's nothing to preview yet.
  useEffect(() => {
    if (roomId) {
      setTabView("preview");
    } else {
      setTabView("config");
    }
  }, [roomId]);

  // Preview zoom + auto-fit
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ width: 800, height: 600 });
  const [zoomMode, setZoomMode] = useState<number | null>(null);

  useEffect(() => {
    const el = previewFrameRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setFrameSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const fitScale = Math.min(1, frameSize.width / PAPER_WIDTH_PX);
  const effectiveScale = zoomMode ?? fitScale;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // Save-as-PDF names the file after the TOP document's title — borrow the
    // report iframe's own <title> (set via generateMetadata) for the print,
    // then restore. Otherwise every PDF gets the admin page's constant title.
    const originalTitle = document.title;
    const reportTitle = iframeRef.current?.contentDocument?.title;
    try {
      if (reportTitle) document.title = reportTitle;
      win.focus();
      win.print();
    } catch (err) {
      console.error("Print failed", err);
    } finally {
      setTimeout(() => {
        document.title = originalTitle;
      }, 1000);
    }
  };

  return (
    <div className="pp5-split-container">
      <div className={`pp5-split pp5-split--tab-${tabView}`}>
        <div className="pp5-tabs" role="tablist" aria-label="มุมมอง">
          <button
            type="button"
            role="tab"
            aria-selected={tabView === "config"}
            onClick={() => setTabView("config")}
            className={
              tabView === "config" ? "pp5-tab pp5-tab--active" : "pp5-tab"
            }
          >
            ตั้งค่า
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tabView === "preview"}
            onClick={() => setTabView("preview")}
            className={
              tabView === "preview" ? "pp5-tab pp5-tab--active" : "pp5-tab"
            }
          >
            พรีวิว
          </button>
        </div>

        <aside className="pp5-split-left">
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-zinc-900">
              พิมพ์รายงาน ปพ.5 รวมชั้น
            </h2>

            <div className="space-y-3">
              <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                <label className="text-sm text-zinc-700">ระดับชั้น</label>
                <select
                  value={gradeId}
                  onChange={(e) => {
                    setGradeId(e.target.value);
                    setCoverPeriodChoice(undefined);
                    // Reset room selection when grade changes — force the
                    // user to pick a room again so the preview doesn't
                    // surprise-load a room from the new grade.
                    setRoomId("");
                  }}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                >
                  <option value="">— เลือกระดับชั้น —</option>
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Show the room dropdown only when the grade has MORE THAN
                  one room. Single-room grades auto-select via the useEffect
                  above — no need to click anyway. User spec 2026-05-20:
                  "ชั้นที่มีห้องเดียว ไม่ต้องให้เลือกห้องอีก". */}
              {rooms.length > 1 && (
                <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <label className="text-sm text-zinc-700">ห้องเรียน</label>
                  <select
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                  >
                    <option value="">— เลือกห้องเรียน —</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedRoom && (
                <div className="space-y-1">
                  <label htmlFor="pp5-cover-period" className="block text-sm text-zinc-700">สรุปผลการเรียนบนหน้าปก</label>
                  <select
                    id="pp5-cover-period"
                    value={coverPeriod}
                    onChange={(e) => setCoverPeriodChoice(e.target.value as CoverPeriod)}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
                  >
                    <option value="1">เฉพาะภาคเรียนที่ 1</option>
                    <option value="2">เฉพาะภาคเรียนที่ 2</option>
                    {selectedRoom.is_primary && <option value="annual">ทั้งปี (รวมภาคเรียนที่ 1 และ 2)</option>}
                  </select>
                  <p className="text-xs text-zinc-500">
                    {selectedRoom.is_primary
                      ? "เปลี่ยนเฉพาะตารางสรุปผลการเรียนหน้าปก ส่วนอื่นยังเป็นข้อมูลรายปีตามเดิม"
                      : "มัธยมตัดสินรายภาค ใช้รายวิชาและนักเรียนของภาคเรียนที่เลือก"}
                  </p>
                </div>
              )}
              <p className="text-xs text-zinc-500">
                รวมทุกวิชา · ทุกการประเมิน · 1 ห้อง = 1 เล่ม
              </p>
            </div>

            {/* Section toggles */}
            <div className="border-t border-zinc-200 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-800">
                  สิ่งที่จะพิมพ์
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setSections({
                        cover: true,
                        attendance: true,
                        scores: true,
                        characteristics: true,
                        reading: true,
                        competency: true,
                      })
                    }
                    className="font-medium text-blue-700 hover:underline"
                  >
                    ทั้งหมด
                  </button>
                  <span className="text-zinc-300">·</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSections({
                        cover: false,
                        attendance: false,
                        scores: false,
                        characteristics: false,
                        reading: false,
                        competency: false,
                      })
                    }
                    className="font-medium text-zinc-600 hover:underline"
                  >
                    ล้าง
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                {SECTION_KEYS.map((key) => (
                  <SectionToggle
                    key={key}
                    label={SECTION_LABEL[key]}
                    checked={sections[key]}
                    onChange={(v) =>
                      setSections((prev) => ({ ...prev, [key]: v }))
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="pp5-split-right">
          <div className="pp5-preview-toolbar">
            <div className="pp5-preview-zoom">
              <label className="pp5-zoom-label-text" htmlFor="pp5-class-zoom">
                ขนาด
              </label>
              <select
                id="pp5-class-zoom"
                value={zoomMode === null ? "fit" : String(zoomMode)}
                onChange={(e) => {
                  const v = e.target.value;
                  setZoomMode(v === "fit" ? null : Number(v));
                }}
                disabled={!canPreview}
                className="pp5-zoom-select"
              >
                <option value="fit">พอดี ({Math.round(fitScale * 100)}%)</option>
                <option value="0.25">25%</option>
                <option value="0.5">50%</option>
                <option value="0.75">75%</option>
                <option value="1">100%</option>
                <option value="1.25">125%</option>
                <option value="1.5">150%</option>
                <option value="2">200%</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handlePrint}
              // Also disable while the iframe is loading — clicking print
              // before the preview finishes can print an incomplete page
              // OR the previously cached preview. User spec 2026-05-20:
              // "ขณะที่รอโหลดพรีวิว ห้ามให้กดปุ่มพิมพ์รายงาน".
              disabled={!canPreview || isLoading || iframeSrc !== previewSrc}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer className="size-4" aria-hidden />
              พิมพ์รายงาน
            </button>
          </div>

          <div ref={previewFrameRef} className="pp5-preview-frame">
            {iframeSrc ? (
              <>
                <div
                  className="pp5-preview-paper"
                  style={{
                    width: PAPER_WIDTH_PX * effectiveScale,
                    height: Math.max(100, frameSize.height),
                  }}
                >
                  <iframe
                    ref={iframeRef}
                    key={iframeSrc}
                    src={iframeSrc}
                    title="ปพ.5 รวมชั้น พรีวิว"
                    onLoad={() => setIsLoading(false)}
                    style={{
                      width: PAPER_WIDTH_PX,
                      height:
                        effectiveScale > 0
                          ? Math.max(100, frameSize.height / effectiveScale)
                          : Math.max(100, frameSize.height),
                      transform: `scale(${effectiveScale})`,
                      transformOrigin: "top left",
                      border: 0,
                      background: "#ffffff",
                      position: "absolute",
                      top: 0,
                      left: 0,
                    }}
                  />
                </div>
                {isLoading && (
                  <div className="pp5-split-loading">
                    <Loader2
                      className="size-5 animate-spin text-primary-600"
                      aria-hidden
                    />
                    <span className="text-sm text-zinc-600">
                      กำลังโหลดพรีวิว…
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="pp5-split-empty">
                <div className="flex flex-col items-center text-center">
                  <p className="text-sm font-medium text-zinc-700">
                    {classrooms.length === 0
                      ? "ยังไม่มีห้องเรียน"
                      : !gradeId
                        ? "เลือกระดับชั้นก่อน"
                        : !selectedRoom
                          ? "เลือกห้องเรียนก่อน"
                          : enabledSections.length === 0
                            ? "ยังไม่ได้เลือกส่วนที่จะพิมพ์"
                            : "ยังไม่พร้อม"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {classrooms.length === 0
                      ? "เพิ่มห้องเรียนที่เมนูตั้งค่าก่อน"
                      : !gradeId
                        ? "เลือกระดับชั้นที่ dropdown ในแท็ปตั้งค่า"
                        : !selectedRoom
                          ? "เลือกที่ dropdown ในแท็ปตั้งค่า เพื่อโหลดพรีวิว"
                          : enabledSections.length === 0
                            ? "เปิดอย่างน้อย 1 รายการในแท็ปตั้งค่า"
                            : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => setTabView("config")}
                    className="pp5-empty-back-btn"
                  >
                    ← ไปที่แท็ปตั้งค่า
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-1.5 hover:border-zinc-300">
      <span className="text-sm text-zinc-800">{label}</span>
      <span className="relative inline-block">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="block h-5 w-9 rounded-full bg-zinc-300 transition-colors peer-checked:bg-emerald-500" />
        <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}
