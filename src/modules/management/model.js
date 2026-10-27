import mongoose from "mongoose";
import { L, baseOptions, imagePath, listable, optionalL, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

// Board / management (About → Management). Empty until the client supplies names and photos.
const managementSchema = new Schema(
    {
        _id: stringId,
        name: { type: L, required: true },
        role: { type: L, default: () => ({}) },
        photo: imagePath,
        message: optionalL,
    },
    baseOptions,
);
listable(managementSchema);

export const Management = model("Management", managementSchema, "management");
