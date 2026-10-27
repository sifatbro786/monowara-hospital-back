import { z } from "zod";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zImage, zL, zLRequired, zOrder, zPosition } from "../../lib/admin.js";
import { HeroSlide } from "./model.js";

// /api/admin/hero — homepage slider (hero.manage). Buttons are global; interval = settings.heroSlider.
export default crudRouter({
    Model: HeroSlide,
    entity: "hero",
    permission: "hero.manage",
    what: "Slide",
    required: ["label", "image"],
    slugFrom: (b) => b.label?.en ?? "",
    label: (d) => d.label?.en ?? d._id,
    search: ["label.en", "title.en", "title.bn"],
    fields: {
        label: zLRequired(60), // admin name
        eyebrow: zL(120),
        title: zL(140), // *phrase* = italic accent
        subtitle: zL(300),
        image: z
            .object({
                src: zImage("hero").refine((v) => v !== null, "upload the slide image"),
                alt: zL(200),
                position: zPosition.default("center"),
            })
            .strict(),
        isActive: zBool,
        order: zOrder,
    },
    async inUse(doc) {
        if (doc.isActive === false) return [];
        const others = await HeroSlide.countDocuments({ _id: { $ne: doc._id }, isActive: { $ne: false } });
        return others ? [] : ["the homepage (it's the only visible slide)"];
    },
});
