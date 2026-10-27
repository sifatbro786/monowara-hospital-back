import mongoose from "mongoose";
import { L, baseOptions } from "../../lib/schema.js";

const { Schema, model } = mongoose;

export const SETTINGS_ID = "settings_main";

const phone = { type: String, trim: true, default: null, match: /^\+?[0-9\-\s]{5,20}$/ };

const Phone = new Schema(
    { label: { type: L, default: () => ({}) }, number: { ...phone, required: true }, order: { type: Number, default: 0 }, isActive: { type: Boolean, default: true } },
    { _id: false },
);

// Each WhatsApp desk keeps an _id: the admin edits/reorders them and tap analytics reference it.
const WhatsappNumber = new Schema({
    _id: { type: String, required: true },
    label: { type: L, default: () => ({}) },
    number: { ...phone, required: true },
    isPrimary: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
});

/**
 * Singleton (`_id: "settings_main"`). Everything here is PUBLIC (GET /api/settings returns it).
 * Private config added later (form recipient emails, SMTP…) must use `select: false`.
 */
const settingsSchema = new Schema(
    {
        _id: { type: String, default: SETTINGS_ID },
        siteName: { type: L, default: () => ({}) },
        legalName: { type: L, default: () => ({}) },
        hotline: phone,
        emergency: phone,
        ambulance: phone,
        landline: phone,
        phones: { type: [Phone], default: [] },
        whatsappNumbers: { type: [WhatsappNumber], default: [] },
        bookingMode: { type: String, enum: ["numbers", "form", "both"], default: "numbers" },
        heroSlider: { intervalSec: { type: Number, min: 2, max: 15, default: 5 } },
        email: { type: String, trim: true, lowercase: true, default: null },
        address: { type: L, default: () => ({}) },
        hours: { emergency: { type: L, default: () => ({}) }, opd: { type: L, default: () => ({}) } },
        dghsLicence: { type: String, trim: true, default: null },
        yearsServing: { type: Number, min: 0, default: null },
        socials: {
            facebook: { type: String, default: null },
            instagram: { type: String, default: null },
            youtube: { type: String, default: null },
            linkedin: { type: String, default: null },
        },
        map: { embed: { type: String, default: null }, directions: { type: String, default: null } },
        noticeBar: {
            isActive: { type: Boolean, default: false },
            text: { type: L, default: () => ({}) },
            href: { type: String, default: null },
        },
    },
    baseOptions,
);

export const Settings = model("Settings", settingsSchema, "settings");
