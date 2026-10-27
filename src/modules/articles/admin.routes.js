import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zDay, zId, zImage, zL, zLRequired, zOrder } from "../../lib/admin.js";
import { Article } from "./model.js";
import { Doctor } from "../doctors/model.js";
import { Bhrpc } from "../programs/model.js";

// /api/admin/articles — Health tips & news (articles.manage = graphics_design + super admin).
const doctorRef = zId.nullable();
async function assertDoctor(id, field) {
    if (id && !(await Doctor.exists({ _id: id }))) {
        throw new AppError(400, "UNKNOWN_DOCTOR", "That doctor doesn't exist.", [{ path: [field], message: "unknown doctor" }]);
    }
}

export default crudRouter({
    Model: Article,
    entity: "articles",
    permission: "articles.manage",
    what: "Article",
    required: ["title", "category"],
    slugFrom: (b) => b.title?.en ?? "",
    label: (d) => d.title?.en,
    search: ["title.en", "title.bn", "slug", "excerpt.en", "category"],
    sort: { publishedAt: -1, order: 1, _id: 1 }, // newest first, like the site
    fields: {
        category: z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9_-]+$/, "one word, e.g. pregnancy"),
        title: zLRequired(200),
        excerpt: zL(400),
        image: zImage("articles"),
        readMinutes: z.number().int().min(1).max(120).nullable(),
        publishedAt: zDay.refine((v) => v !== null, "pick the publish date"),
        sections: z
            .array(z.object({ heading: zL(200), body: zL(8000) }).strict())
            .max(30),
        author: doctorRef, // doctor byline (E-E-A-T)
        reviewedBy: doctorRef,
        isActive: zBool,
        order: zOrder,
    },
    query: { category: z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9_-]+$/).optional() },
    filter: ({ category }) => (category ? { category } : {}),
    async check(body) {
        await assertDoctor(body.author, "author");
        await assertDoctor(body.reviewedBy, "reviewedBy");
    },
    beforeSave(doc) {
        if (!doc.publishedAt) doc.publishedAt = new Date(); // new article without a date = today
    },
    async inUse(doc) {
        return (await Bhrpc.exists({ topics: doc.slug })) ? ["the BHRPC page's reading list"] : [];
    },
});

/** GET /api/admin/articles/options — doctor picker for bylines (graphics_design can't read /admin/doctors). */
export async function articleOptions(_req, res) {
    const doctors = await Doctor.find({}, { name: 1, designation: 1, isActive: 1 }).sort({ order: 1, _id: 1 }).lean();
    res.json({ data: { doctors } });
}
