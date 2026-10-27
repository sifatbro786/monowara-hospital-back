/**
 * Role → permission map — the ONE place to change who can do what. Routes only ever ask for a
 * permission, never for a role. Roles confirmed by the client (2026-10-27):
 *
 *  super_admin      full power: everything below + users & roles, settings (numbers, WhatsApp desks,
 *                   booking mode), activity log
 *  opd_incharge     the hospital operations side: doctors (profiles, chamber times, leave),
 *                   departments/facilities/diagnostics, packages, Aesthetic/BHRPC teams, bookings,
 *                   messages, careers, FAQs
 *  graphics_design  site content: hero slider, homepage blocks, image slots, gallery, health tips &
 *                   news, patient stories, notice bar, content pages (About, Patients & Visitors…)
 *  marketer         SEO management (per-page Google title/description)
 */
export const ROLES = ["super_admin", "opd_incharge", "graphics_design", "marketer"];

const OPD = ["opd_incharge"];
const GFX = ["graphics_design"];
const MKT = ["marketer"];

// super_admin is implied for every permission (see can()).
const MAP = {
    // super admin only
    "users.manage": [],
    "settings.manage": [], // hotline, WhatsApp/phone numbers, booking mode, hours, socials, DGHS…
    "activity.read": [],
    "legal.manage": [], // privacy policy, patient rights, terms — legal text stays with the super admin

    // opd_incharge
    "doctors.manage": OPD,
    "departments.manage": OPD, // + facilities, diagnostics
    "packages.manage": OPD,
    "programs.manage": OPD, // MH Aesthetic + BHRPC
    "bookings.manage": OPD,
    "messages.manage": OPD,
    "careers.manage": OPD, // jobs + applications/CVs
    "faqs.manage": OPD, // chatbot answers are operational (timings, booking, visiting)

    // graphics_design
    "hero.manage": GFX,
    "home.manage": GFX, // key numbers, centres, expert talks
    "media.manage": GFX, // image slots + uploads
    "gallery.manage": GFX,
    "articles.manage": GFX, // health tips & news
    "stories.manage": GFX, // consent confirmation required
    "notice.manage": GFX, // settings.noticeBar only
    "pages.manage": GFX, // About, Patients & Visitors, Management

    // marketer
    "seo.manage": MKT,
};

export const PERMISSIONS = Object.keys(MAP);

export function can(role, permission) {
    if (!(permission in MAP)) throw new Error(`Unknown permission "${permission}"`); // typo guard
    return role === "super_admin" || MAP[permission].includes(role);
}

/** Every permission a role holds — sent to the admin UI to show/hide menu items (server still checks). */
export const permissionsFor = (role) => PERMISSIONS.filter((p) => can(role, p));
