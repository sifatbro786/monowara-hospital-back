import { z } from "zod";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zImage, zL, zOrder } from "../../lib/admin.js";
import { GalleryItem } from "./model.js";

// /api/admin/gallery — photos (gallery.manage = graphics_design + super admin). Bulk upload in the
// dashboard = one POST per photo after each upload.
export default crudRouter({
    Model: GalleryItem,
    entity: "gallery",
    permission: "gallery.manage",
    what: "Photo",
    sluggable: false,
    required: ["src"],
    label: (d) => d.caption?.en || d.src,
    search: ["caption.en", "caption.bn", "category", "src"],
    fields: {
        // existing items reuse hero/facility photos; new uploads go to /uploads/gallery
        src: zImage("(?:gallery|hero|home|departments|facilities|diagnostics|media|aesthetic)").refine((v) => v !== null, "upload the photo"),
        category: z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9_-]+$/, "one word, e.g. hospital"),
        caption: zL(200),
        isActive: zBool,
        order: zOrder,
    },
    query: { category: z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9_-]+$/).optional() },
    filter: ({ category }) => (category ? { category } : {}),
});
