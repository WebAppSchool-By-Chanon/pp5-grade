"use client";

import { cn } from "@pp5/ui";
import {
  Activity,
  Award,
  BarChart3,
  BookOpen,
  Brain,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarX,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  ClipboardList,
  Database,
  FileText,
  GraduationCap,
  Heart,
  LayoutDashboard,
  Layers,
  Loader2,
  LogOut,
  Printer,
  School,
  Settings,
  Sparkles,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { InstallButton } from "./install-button";
import { useMobileNav } from "./mobile-nav-context";
import { useNavigationStatus } from "./navigation-status-context";

/**
 * Renders the link icon → swaps to a spinner the moment its parent `<Link>`
 * triggers navigation. `useLinkStatus()` is provided by Next.js 16 and only
 * works when this component is rendered inside a `<Link>`.
 *
 * It ALSO doubles as the trigger for the page-content navigation overlay:
 * when `pending` flips true for a link to a DIFFERENT path, it bumps the
 * navigation token so `<NavigationOverlay>` can cover the stale page with
 * a skeleton immediately (see navigation-status-context.tsx). We skip the
 * bump when `href === pathname` (clicking the current page) so the overlay
 * doesn't flash for a no-op navigation.
 */
function LinkIcon({ icon: Icon, href }: { icon: LucideIcon; href: string }) {
  const { pending } = useLinkStatus();
  const { bumpNav } = useNavigationStatus();
  const pathname = usePathname();
  useEffect(() => {
    if (pending && href !== pathname) bumpNav();
  }, [pending, href, pathname, bumpNav]);
  return pending ? (
    <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden />
  ) : (
    <Icon className="h-4 w-4" aria-hidden />
  );
}

type NavLink = {
  href: string;
  icon: LucideIcon;
  label: string;
};

type NavSection = {
  id: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  links: NavLink[];
};

const TOP_LINKS: NavLink[] = [
  { href: "/", icon: LayoutDashboard, label: "หน้าหลัก" },
];

const SECTIONS: NavSection[] = [
  {
    id: "settings",
    label: "ตั้งค่าพื้นฐาน",
    icon: Settings,
    adminOnly: true,
    links: [
      { href: "/setup/school", icon: Building2, label: "ข้อมูลโรงเรียน" },
      {
        href: "/setup/academic-years",
        icon: CalendarDays,
        label: "ปีการศึกษา",
      },
      { href: "/setup/classrooms", icon: School, label: "ชั้นเรียน" },
      { href: "/setup/holidays", icon: CalendarX, label: "ตั้งค่าวันหยุด" },
    ],
  },
  {
    id: "data",
    label: "จัดการข้อมูล",
    icon: Database,
    adminOnly: true,
    links: [
      { href: "/setup/teachers", icon: Users, label: "ข้อมูลครู" },
      {
        href: "/setup/students",
        icon: GraduationCap,
        label: "ข้อมูลนักเรียน",
      },
      { href: "/setup/subjects", icon: BookOpen, label: "ข้อมูลรายวิชา" },
      {
        href: "/setup/teaching",
        icon: ClipboardCheck,
        label: "จัดครูเข้าสอน",
      },
      {
        href: "/setup/homerooms",
        icon: UserCheck,
        label: "ครูประจำชั้น",
      },
    ],
  },
  {
    id: "assessment",
    label: "การประเมิน",
    icon: BarChart3,
    // Open to teachers — teachers see only subjects they teach (per-page
    // filter applies in Phase 2). User spec 2026-05-20: "ครูจะทำงานได้
    // 3 กลุ่มเมนู: การประเมิน บันทึกเวลาเรียน พิมพ์เล่มรายงาน".
    adminOnly: false,
    links: [
      {
        href: "/setup/score-structure",
        icon: ClipboardList,
        label: "บันทึกคะแนน",
      },
      {
        href: "/setup/activities",
        icon: Award,
        label: "กิจกรรมพัฒนาผู้เรียน",
      },
      {
        href: "/setup/characteristics",
        icon: Heart,
        label: "คุณลักษณะ",
      },
      {
        href: "/setup/reading-thinking",
        icon: Brain,
        label: "อ่าน คิด เขียน",
      },
      {
        href: "/setup/competency",
        icon: Activity,
        label: "สมรรถนะสำคัญ",
      },
      {
        href: "/setup/abilities",
        icon: Sparkles,
        label: "ความสามารถ 8 ด้าน",
      },
    ],
  },
  {
    // Split from "การประเมิน" — เวลาเรียนมี 2 รูปแบบ:
    //   - รายวัน    : ครูประจำชั้นเช็คตอนเช้า (เหมาะกับประถม)
    //   - รายวิชา   : ครูประจำวิชาเช็คตามคาบ × สัปดาห์ (เหมาะกับมัธยม
    //                 ตามมาตรฐาน ปพ.5 — 20 สัปดาห์ × หน่วยกิต×2 ช่อง)
    id: "time",
    label: "บันทึกเวลาเรียน",
    icon: CalendarClock,
    // Open to teachers (Phase 1). Daily = homeroom only · per-subject =
    // their own offerings (Phase 2 filters).
    adminOnly: false,
    links: [
      {
        href: "/setup/attendance",
        icon: CalendarCheck,
        label: "รายวัน(โฮมรูม)",
      },
      {
        href: "/setup/attendance/by-subject",
        icon: BookOpen,
        label: "รายวิชา",
      },
    ],
  },
  {
    // พิมพ์ ปพ.5 (เล่มรายงาน) — admin เลือก ห้อง / วิชา / ภาค แล้วสั่งพิมพ์
    //   - รายวิชา   : 1 วิชา × 1 ห้อง × 1 ภาค (มีอยู่แล้ว)
    //   - รวมชั้น  : 1 ห้อง × 1 ปี (สรุปทุกวิชา + ประเมิน — ยังไม่พร้อมใช้)
    id: "reports",
    label: "พิมพ์เล่มรายงาน",
    icon: Printer,
    // Open to teachers (Phase 1). ปพ.5 รายวิชา = their own subjects ·
    // ปพ.5 รวมชั้น = their homeroom classrooms only (Phase 2 filters).
    adminOnly: false,
    links: [
      {
        href: "/reports/pp5",
        icon: FileText,
        label: "ปพ.5 รายวิชา",
      },
      {
        href: "/reports/pp5-class",
        icon: Layers,
        label: "ปพ.5 รวมชั้น",
      },
      {
        href: "/reports/pp6",
        icon: FileText,
        label: "ปพ.6 รายนักเรียน",
      },
    ],
  },
];

type SidebarUser = {
  title: string | null;
  fullName: string;
  roleLabel: string;
  username: string;
};

type Props = {
  isAdmin: boolean;
  user: SidebarUser;
  logoutAction: () => Promise<void>;
  /** Optional school logo URL — rendered next to the "ระบบ ปพ.5" brand
   *  at the top of the sidebar. Falls back to no image if null/empty. */
  schoolLogoUrl?: string | null;
};

/**
 * Does `pathname` match `href` exactly, or as a parent prefix of a sub-route?
 * Used both for the section-open detection (any matching link → open the
 * section) AND as the building block for `findBestMatchHref`.
 */
function pathMatches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Pick THE single link whose href is the longest match against `pathname`.
 *
 * Without this, both `/setup/attendance` and `/setup/attendance/by-subject`
 * would render as active when the user is on the by-subject page (because
 * both have the parent path as a prefix). Longest-prefix-wins picks the
 * more-specific child link, leaving the parent inactive.
 */
function findBestMatchHref(
  pathname: string,
  links: NavLink[],
): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const link of links) {
    if (pathMatches(pathname, link.href) && link.href.length > bestLen) {
      best = link.href;
      bestLen = link.href.length;
    }
  }
  return best;
}

export function Sidebar({ isAdmin, user, logoutAction, schoolLogoUrl }: Props) {
  const pathname = usePathname();
  /** Mobile drawer state — shared with `MobileHeader`'s hamburger button
   *  via context. Desktop ignores this (always renders the sidebar
   *  static in the page flow). */
  const { open: mobileOpen, setOpen: setMobileOpen } = useMobileNav();
  const closeMobileDrawer = () => setMobileOpen(false);

  /** Whole sidebar collapsed → icon-only rail. */
  const [collapsed, setCollapsed] = useState(false);

  /** Which group sections are expanded (only meaningful when !collapsed). */
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const s of SECTIONS) {
      if (s.links.some((l) => pathMatches(pathname, l.href))) {
        initial.add(s.id);
      }
    }
    return initial;
  });

  // Precompute the single best-matching href across ALL nav links so we can
  // mark exactly one link as active (avoids both "รายวัน" and "รายวิชา"
  // lighting up when the user is on `/setup/attendance/by-subject`).
  const allLinks: NavLink[] = [
    ...TOP_LINKS,
    ...SECTIONS.flatMap((s) => s.links),
  ];
  const activeHref = findBestMatchHref(pathname, allLinks);

  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSectionClick(id: string) {
    if (collapsed) {
      // Expand sidebar AND open this section so children become visible
      setCollapsed(false);
      setOpenSections((prev) => new Set([...prev, id]));
    } else {
      toggleSection(id);
    }
  }

  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || isAdmin);

  return (
    <>
      {/* Mobile drawer backdrop — only renders when drawer is open,
          click anywhere outside the panel to close. Hidden on desktop
          (`md:hidden`). User spec 2026-05-22: hamburger + drawer for
          mobile menu access. */}
      {mobileOpen && (
        <div
          className="no-print fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={closeMobileDrawer}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "no-print shrink-0 flex-col border-r border-zinc-200 bg-white transition-[width] duration-200 ease-out",
          // Mobile drawer state — fixed overlay when open, hidden when
          // closed. Desktop overrides (md:) below put it back into the
          // page flow.
          mobileOpen ? "fixed inset-y-0 left-0 z-50 flex w-72" : "hidden",
          "md:relative md:z-auto md:flex md:!inset-auto",
          // Expanded width = 288px (was 240px) so the longer brand
          // "ระบบบันทึกผลการเรียน" + chevron toggle fit on one line at
          // text-sm without truncation. User spec 2026-05-22.
          collapsed ? "md:w-16" : "md:w-72",
        )}
      >
      {/* Brand + collapse toggle.
          Logo (if uploaded by admin at /setup/school):
            - Expanded sidebar → logo + "ระบบ ปพ.5" + "หลังบ้าน" stack
            - Collapsed rail → logo replaces the brand text (collapse
              toggle still sits beside it) */}
      <div
        className={cn(
          "flex items-center border-b border-zinc-200",
          collapsed ? "justify-center px-2 py-4" : "justify-between px-5 py-4",
        )}
      >
        {!collapsed && (
          <div className="flex min-w-0 items-center gap-2">
            {schoolLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={schoolLogoUrl}
                alt="โลโก้โรงเรียน"
                className="h-8 w-8 shrink-0 rounded object-contain"
              />
            )}
            <div className="min-w-0">
              <h1 className="truncate whitespace-nowrap text-sm font-bold text-zinc-900">
                ระบบบันทึกผลการเรียน
              </h1>
              <p className="truncate text-xs text-zinc-500">
                (ปพ.5 ออนไลน์)
              </p>
            </div>
          </div>
        )}
        {collapsed && schoolLogoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={schoolLogoUrl}
            alt="โลโก้โรงเรียน"
            className="h-7 w-7 shrink-0 rounded object-contain"
          />
        )}
        {/* Mobile: X to close drawer · Desktop: collapse toggle. The
            collapse toggle is hidden on mobile because the drawer is
            always shown fully (not as a rail). */}
        <button
          type="button"
          onClick={closeMobileDrawer}
          aria-label="ปิดเมนู"
          title="ปิดเมนู"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus:ring-2 focus:ring-primary-600 md:hidden"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"}
          title={collapsed ? "ขยายเมนู" : "ย่อเมนู"}
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus:ring-2 focus:ring-primary-600 md:inline-flex"
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <ChevronsLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className={cn("flex-1 space-y-0.5", collapsed ? "p-2" : "p-3")}>
        {TOP_LINKS.map((link) => {
          const isActive = link.href === activeHref;
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={closeMobileDrawer}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? link.label : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md text-sm transition-colors",
                collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
                isActive
                  ? "bg-primary-50 font-semibold text-primary-700"
                  : "font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900",
              )}
            >
              <LinkIcon icon={link.icon} href={link.href} />
              {!collapsed && link.label}
            </Link>
          );
        })}

        {visibleSections.map((section) => {
          const SectionIcon = section.icon;
          const isOpen = openSections.has(section.id);
          // Section button styling — any link in the section matching the
          // current pathname (parent OR exact) keeps the parent button in
          // the "highlighted text" state, even though the active blue pill
          // sits on the specific child link only.
          const sectionHasActive = section.links.some((l) =>
            pathMatches(pathname, l.href),
          );

          return (
            <div key={section.id} className="pt-2">
              <button
                type="button"
                onClick={() => handleSectionClick(section.id)}
                aria-expanded={collapsed ? undefined : isOpen}
                title={collapsed ? section.label : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md text-sm font-medium transition-colors",
                  collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
                  sectionHasActive
                    ? "text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900",
                )}
              >
                <SectionIcon className="h-4 w-4" aria-hidden="true" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{section.label}</span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-zinc-400 transition-transform",
                        !isOpen && "-rotate-90",
                      )}
                      aria-hidden="true"
                    />
                  </>
                )}
              </button>

              {!collapsed && isOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {section.links.map((link) => {
                    const isActive = link.href === activeHref;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={closeMobileDrawer}
                        aria-current={isActive ? "page" : undefined}
                        className={
                          isActive
                            ? "flex items-center gap-2.5 rounded-md bg-primary-50 py-2 pl-9 pr-3 text-sm font-semibold text-primary-700"
                            : "flex items-center gap-2.5 rounded-md py-2 pl-9 pr-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                        }
                      >
                        <LinkIcon icon={link.icon} href={link.href} />
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User panel */}
      <div
        className={cn(
          "border-t border-zinc-200",
          collapsed ? "p-2" : "p-3",
        )}
      >
        {!collapsed && (
          <div className="px-2 pb-3">
            <p className="truncate text-sm font-medium text-zinc-900">
              {user.title}
              {user.fullName}
            </p>
            <p className="truncate text-xs text-zinc-500">
              {user.roleLabel} ·{" "}
              <span className="font-mono">{user.username}</span>
            </p>
          </div>
        )}
        <InstallButton collapsed={collapsed} />
        <form action={logoutAction}>
          <button
            type="submit"
            title={collapsed ? "ออกจากระบบ" : undefined}
            aria-label={collapsed ? "ออกจากระบบ" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md border border-zinc-300 bg-white text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-primary-600 focus:ring-offset-1",
              collapsed
                ? "h-9 w-full justify-center"
                : "w-full justify-center px-3 py-1.5",
            )}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            {!collapsed && "ออกจากระบบ"}
          </button>
        </form>
      </div>
      </aside>
    </>
  );
}
