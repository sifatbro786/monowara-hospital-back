import mongoose from "mongoose";
import { stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

/**
 * "Who changed what and when" (proposal §5.4). Append-only: no update/delete route exists.
 * The actor is snapshotted so the log still reads correctly after a user is renamed or deactivated.
 */
const activitySchema = new Schema(
    {
        _id: stringId,
        at: { type: Date, default: Date.now },
        actor: {
            _id: { type: String, default: null }, // null = anonymous (failed login)
            name: { type: String, default: null },
            email: { type: String, default: null },
            role: { type: String, default: null },
        },
        action: { type: String, required: true }, // "auth.login", "users.create", "doctors.update"…
        entity: { type: String, default: null }, // collection / module
        entityId: { type: String, default: null },
        summary: { type: String, default: null, maxlength: 300 },
        changes: { type: Schema.Types.Mixed, default: undefined }, // { field: [before, after] } (B2)
        ip: { type: String, default: null },
        userAgent: { type: String, default: null, maxlength: 300 },
    },
    { versionKey: false },
);
activitySchema.index({ at: -1 });
activitySchema.index({ "actor._id": 1, at: -1 });
activitySchema.index({ entity: 1, entityId: 1, at: -1 });
activitySchema.index({ action: 1, at: -1 });

export const Activity = model("Activity", activitySchema, "activity");
