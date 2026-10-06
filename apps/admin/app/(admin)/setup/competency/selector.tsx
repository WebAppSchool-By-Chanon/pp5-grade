"use client";

import { Select } from "@pp5/ui";
import { useRouter } from "next/navigation";
import { useFilterNav } from "../_components/filter-nav-context";
import { useOptimisticValue } from "../_components/use-optimistic-value";

export type GradeOption = { id: string; label: string };
export type RoomOption = { id: string; label: string };

type Props = {
  grades: GradeOption[];
  selectedGradeId: string;
  rooms: RoomOption[];
  selectedRoomId: string;
  basePath?: string;
};

/** Top selector for /setup/competency — grade + room dropdowns. */
export function CompetencySelector({
  grades,
  selectedGradeId,
  rooms,
  selectedRoomId,
  basePath = "/setup/competency",
}: Props) {
  const router = useRouter();
  const { startNav } = useFilterNav();
  // Optimistic mirrors so each dropdown snaps to the picked value instantly,
  // instead of waiting for the RSC navigation to commit.
  const [gradeVal, setGradeOpt] = useOptimisticValue(selectedGradeId);
  const [roomVal, setRoomOpt] = useOptimisticValue(selectedRoomId);

  const navigate = (grade: string, room: string) => {
    startNav();
    const params = new URLSearchParams();
    if (grade) params.set("grade", grade);
    if (room) params.set("room", room);
    router.push(`${basePath}?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-zinc-700">ระดับชั้น:</label>
        <Select
          value={gradeVal}
          onChange={(e) => {
            setGradeOpt(e.target.value);
            navigate(e.target.value, "");
          }}
          className="w-32"
        >
          <option value="">— เลือกชั้น —</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </Select>
      </div>

      {/* Room dropdown only when the grade has 2+ rooms — single-room grades
          auto-select server-side (user spec 2026-05-31, revised). */}
      {selectedGradeId && rooms.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-700">เลือกห้อง:</label>
          <Select
            value={roomVal}
            onChange={(e) => {
              setRoomOpt(e.target.value);
              navigate(selectedGradeId, e.target.value);
            }}
            className="w-36"
          >
            <option value="">— เลือกห้อง —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
