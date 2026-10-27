import { z } from "zod";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zDay, zImage, zL, zLOptional, zLRequired, zOrder, zPath } from "../../lib/admin.js";
import { Centre, KeyNumber, Story, Talk } from "./model.js";

// Homepage blocks (home.manage) + patient stories (stories.manage). Not sluggable.
const common = { sluggable: false, isActive: zBool, order: zOrder };

export const keyNumbersRouter = crudRouter({
    Model: KeyNumber,
    entity: "keynumbers",
    permission: "home.manage",
    what: "Key number",
    sluggable: false,
    required: ["value", "label"],
    label: (d) => `${d.value?.en} ${d.label?.en}`,
    search: ["value.en", "label.en", "label.bn"],
    fields: { value: zLRequired(12), label: zLRequired(60), isActive: common.isActive, order: common.order },
});

export const centresRouter = crudRouter({
    Model: Centre,
    entity: "centres",
    permission: "home.manage",
    what: "Centre",
    sluggable: false,
    required: ["title", "href"],
    label: (d) => d.title?.en,
    search: ["title.en", "title.bn", "summary.en", "href"],
    fields: {
        title: zLRequired(80),
        summary: zL(200),
        href: zPath,
        // existing cards use department/facility photos; new uploads go to /uploads/home
        image: zImage("(?:home|departments|facilities|diagnostics|media)"),
        isActive: common.isActive,
        order: common.order,
    },
});

export const talksRouter = crudRouter({
    Model: Talk,
    entity: "talks",
    permission: "home.manage",
    what: "Expert talk",
    sluggable: false,
    required: ["youtubeId", "title"],
    label: (d) => d.title?.en,
    search: ["title.en", "title.bn", "speaker.en", "youtubeId"],
    fields: {
        youtubeId: z.string().trim().regex(/^[\w-]{11}$/, "the 11-character YouTube video id"),
        title: zLRequired(160),
        speaker: zL(120),
        isActive: common.isActive,
        order: common.order,
    },
});

/**
 * Patient stories — never public without recorded written consent (proposal §3, §13). The public
 * API filters on consent.confirmed; here the server stamps who recorded it (from the session, not
 * the request body) and clears the stamp when consent is withdrawn.
 */
export const storiesRouter = crudRouter({
    Model: Story,
    entity: "stories",
    permission: "stories.manage",
    what: "Story",
    sluggable: false,
    required: ["quote", "name"],
    label: (d) => d.name?.en,
    search: ["name.en", "name.bn", "quote.en", "quote.bn"],
    fields: {
        quote: zLRequired(600),
        name: zLRequired(80),
        context: zLOptional(120),
        consent: z.object({ confirmed: zBool, date: zDay.default(null) }).strict(),
        isActive: common.isActive,
        order: common.order,
    },
    beforeSave(doc, body, req) {
        if (!body.consent) return;
        if (body.consent.confirmed) {
            if (!doc.consent.date) doc.consent.date = new Date();
            doc.consent.recordedBy = req.user.name;
        } else {
            doc.consent.date = null;
            doc.consent.recordedBy = null;
        }
    },
});
