/**
 * Medicine Information Service.
 * Detects medicine queries and returns structured info via Gemini (real-time)
 * with a built-in fallback DB. Faithful port of the Python medicine_info.py.
 */
import { settings } from "../config.js";

export interface MedicineInfo {
  name: string;
  also_known_as: string[];
  type: string;
  used_for: string[];
  how_it_works: string;
  common_dosage: string;
  available_otc: boolean | null;
  prescription_required: boolean | null;
  common_side_effects: string[];
  warnings: string;
  consult_doctor_if: string;
  disclaimer: string;
}

const DISCLAIMER =
  "For informational purposes only. Always consult a doctor or pharmacist before taking any medicine.";

const KNOWN_MEDICINES = new Set<string>([
  "ipill", "i-pill", "unwanted 72", "unwanted72", "mifepristone", "misoprostol",
  "crocin", "dolo", "dolo 650", "paracetamol", "combiflam", "ibuprofen",
  "brufen", "zerodol", "aspirin", "ecosprin", "nimesulide", "nimuslide",
  "azithromycin", "azithral", "amoxicillin", "amoxyclav", "augmentin",
  "ciprofloxacin", "metronidazole", "flagyl", "doxycycline", "clindamycin",
  "cefixime", "taxim", "norfloxacin",
  "pantoprazole", "pan 40", "pan d", "omeprazole", "omez", "ranitidine",
  "digene", "eno", "gelusil", "ondansetron", "emeset", "vomistop", "domperidone", "domstal",
  "cetirizine", "cetrizine", "cetzine", "allegra", "fexofenadine",
  "montair lc", "montelukast", "levocetrizine",
  "metformin", "glycomet", "glucophage", "januvia", "sitagliptin", "glimepiride", "amaryl",
  "clopidogrel", "plavix", "atorvastatin", "lipitor", "amlodipine",
  "norvasc", "telma", "telmisartan", "atenolol", "metoprolol",
  "thyronorm", "eltroxin", "levothyroxine",
  "shelcal", "calcimax", "calcium", "vitamin d3", "cholecalciferol",
  "limcee", "vitamin c", "becosules", "neurobion", "b complex",
  "otrivin", "nasivion", "xylometazoline", "salinex",
  "betadine", "povidone iodine", "soframycin", "neosporin",
  "fluconazole", "forcan", "clotrimazole", "candid",
  "warfarin", "heparin", "acitrom",
  "prednisolone", "dexamethasone", "methylprednisolone",
  "volini", "diclofenac", "voveran",
  "sertraline", "zoloft", "escitalopram", "nexito", "fluoxetine", "alprazolam", "alprax", "clonazepam",
  "albendazole", "zentel", "ivermectin",
]);

function med(p: Omit<MedicineInfo, "disclaimer"> & { disclaimer?: string }): MedicineInfo {
  return { disclaimer: DISCLAIMER, ...p };
}

const MEDICINE_DB: Record<string, MedicineInfo> = {
  ipill: med({
    name: "i-Pill (Levonorgestrel 1.5 mg)", also_known_as: ["Unwanted 21 Days", "Emergency Pill"], type: "Tablet",
    used_for: ["Emergency contraception", "Prevents pregnancy after unprotected sex"],
    how_it_works: "Delays or prevents ovulation and may prevent implantation of a fertilised egg.",
    common_dosage: "1 tablet taken as soon as possible, within 72 hours of unprotected sex.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Nausea", "Headache", "Irregular bleeding", "Fatigue"],
    warnings: "Not for regular use as contraception. Does not protect against STIs.",
    consult_doctor_if: "You are already pregnant, have unexplained vaginal bleeding, or are on other medications.",
  }),
  "unwanted 72": med({
    name: "Unwanted 72 (Levonorgestrel 0.75 mg × 2)", also_known_as: ["i-Pill alternative", "Plan B equivalent"], type: "Tablet",
    used_for: ["Emergency contraception within 72 hours of unprotected sex"],
    how_it_works: "High-dose progestin that delays ovulation and prevents fertilisation.",
    common_dosage: "2 tablets: first immediately, second 12 hours later; or both at once.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Nausea", "Vomiting", "Breast tenderness", "Spotting"],
    warnings: "Effectiveness decreases the longer you wait after unprotected sex.",
    consult_doctor_if: "No period within 3 weeks of taking the pill.",
  }),
  crocin: med({
    name: "Crocin (Paracetamol 500 mg / 650 mg)", also_known_as: ["Dolo 650", "Paracetamol", "Acetaminophen", "Calpol"], type: "Tablet / Syrup",
    used_for: ["Fever", "Mild to moderate pain", "Headache", "Body ache"],
    how_it_works: "Reduces fever by acting on the heat-regulating centre in the brain; relieves pain by blocking pain signals.",
    common_dosage: "Adults: 500–1000 mg every 4–6 hours as needed; max 4 g/day.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Rare at normal doses; nausea in some people"],
    warnings: "Avoid alcohol. Do not exceed recommended dose — overdose causes serious liver damage.",
    consult_doctor_if: "Fever lasts more than 3 days or you have liver/kidney disease.",
  }),
  "dolo 650": med({
    name: "Dolo 650 (Paracetamol 650 mg)", also_known_as: ["Crocin 650", "Paracetamol 650", "Panadol"], type: "Tablet",
    used_for: ["Fever", "Headache", "Body ache", "Mild pain relief"],
    how_it_works: "Reduces fever and relieves pain by acting on the central nervous system.",
    common_dosage: "1 tablet every 4–6 hours; max 3 tablets/day for adults.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Generally well-tolerated; rare nausea or skin rash"],
    warnings: "Do not combine with other paracetamol-containing products. Avoid in liver disease.",
    consult_doctor_if: "Fever doesn't break in 3 days or pain worsens.",
  }),
  combiflam: med({
    name: "Combiflam (Ibuprofen 400 mg + Paracetamol 325 mg)", also_known_as: ["Brufen Plus", "Ibugesic Plus"], type: "Tablet",
    used_for: ["Pain relief", "Fever", "Muscle ache", "Joint pain", "Dental pain"],
    how_it_works: "Dual action: paracetamol reduces fever; ibuprofen (NSAID) reduces inflammation and pain.",
    common_dosage: "1 tablet 2–3 times daily after meals; max 3 tablets/day.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Stomach upset", "Acidity", "Nausea"],
    warnings: "Avoid on empty stomach. Not suitable for people with peptic ulcers or kidney disease.",
    consult_doctor_if: "You have stomach pain, kidney issues, or are pregnant.",
  }),
  metformin: med({
    name: "Metformin (Metformin HCl)", also_known_as: ["Glycomet", "Glucophage", "Obimet", "Walaphage"], type: "Tablet",
    used_for: ["Type 2 diabetes", "Polycystic Ovary Syndrome (PCOS)", "Pre-diabetes"],
    how_it_works: "Reduces glucose production in the liver and improves insulin sensitivity.",
    common_dosage: "500–2000 mg/day in divided doses with meals; dose adjusted by doctor.",
    available_otc: false, prescription_required: true,
    common_side_effects: ["Nausea", "Diarrhoea", "Stomach upset (usually improves with time)"],
    warnings: "Avoid alcohol. Stop before contrast CT scans. Risk of lactic acidosis in kidney disease.",
    consult_doctor_if: "You have kidney disease, are about to have surgery, or experience unusual muscle pain.",
  }),
  azithromycin: med({
    name: "Azithromycin", also_known_as: ["Azithral", "Zithromax", "Azax", "Aziwin"], type: "Tablet / Syrup",
    used_for: ["Bacterial infections", "Respiratory infections", "Throat infections", "Skin infections", "STIs (chlamydia)"],
    how_it_works: "Macrolide antibiotic — stops bacteria from making proteins needed to grow and multiply.",
    common_dosage: "Adults: 500 mg once daily for 3–5 days (as directed by doctor).",
    available_otc: false, prescription_required: true,
    common_side_effects: ["Nausea", "Diarrhoea", "Stomach pain", "Headache"],
    warnings: "Complete the full course even if you feel better. Not effective against viral infections.",
    consult_doctor_if: "You have heart rhythm problems, liver disease, or severe allergic reaction.",
  }),
  amoxicillin: med({
    name: "Amoxicillin", also_known_as: ["Novamox", "Mox", "Amoxil", "Trimox"], type: "Tablet / Capsule / Syrup",
    used_for: ["Throat infections", "Ear infections", "Urinary tract infections", "Chest infections"],
    how_it_works: "Penicillin-type antibiotic that kills bacteria by disrupting their cell wall formation.",
    common_dosage: "250–500 mg every 8 hours for 5–7 days (as prescribed).",
    available_otc: false, prescription_required: true,
    common_side_effects: ["Rash", "Diarrhoea", "Nausea"],
    warnings: "Inform doctor of penicillin allergy. Avoid if you have mononucleosis (can cause rash).",
    consult_doctor_if: "You develop a rash, difficulty breathing, or symptoms don't improve in 3 days.",
  }),
  pantoprazole: med({
    name: "Pantoprazole", also_known_as: ["Pan 40", "Pan D", "Pantocid", "Pepfiz"], type: "Tablet",
    used_for: ["Acidity", "GERD (acid reflux)", "Peptic ulcers", "H. pylori infection"],
    how_it_works: "Proton pump inhibitor (PPI) — blocks acid-producing pumps in the stomach lining.",
    common_dosage: "40 mg once daily before breakfast for 4–8 weeks.",
    available_otc: false, prescription_required: true,
    common_side_effects: ["Headache", "Diarrhoea", "Flatulence", "Nausea"],
    warnings: "Long-term use may reduce magnesium and vitamin B12 levels. Do not crush tablets.",
    consult_doctor_if: "Symptoms persist after 2 weeks or you have difficulty swallowing.",
  }),
  cetirizine: med({
    name: "Cetirizine", also_known_as: ["Cetzine", "Alerid", "Zyrtec", "Cetcip"], type: "Tablet / Syrup",
    used_for: ["Allergic rhinitis", "Urticaria (hives)", "Hay fever", "Skin allergies", "Watery/itchy eyes"],
    how_it_works: "Second-generation antihistamine — blocks histamine receptors to reduce allergy symptoms without heavy sedation.",
    common_dosage: "10 mg once daily at night; 5 mg for children (as directed).",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Mild drowsiness", "Dry mouth", "Fatigue"],
    warnings: "Avoid alcohol. May cause drowsiness in some people — caution when driving.",
    consult_doctor_if: "Symptoms persist beyond 2 weeks or worsen.",
  }),
  "montair lc": med({
    name: "Montair LC (Montelukast 10 mg + Levocetirizine 5 mg)", also_known_as: ["Monte LC", "Montek LC", "Telekast L"], type: "Tablet",
    used_for: ["Allergic rhinitis", "Chronic urticaria", "Asthma (adjunct)", "Dust allergy"],
    how_it_works: "Dual action: montelukast blocks leukotrienes (inflammation triggers); levocetirizine blocks histamine.",
    common_dosage: "1 tablet at night after food.",
    available_otc: false, prescription_required: true,
    common_side_effects: ["Drowsiness", "Headache", "Dry mouth"],
    warnings: "Take at bedtime to minimise drowsiness. Not for acute asthma attacks.",
    consult_doctor_if: "You experience mood changes, sleep disturbances, or worsening asthma.",
  }),
  aspirin: med({
    name: "Aspirin (Acetylsalicylic Acid)", also_known_as: ["Ecosprin", "Disprin", "Loprin"], type: "Tablet",
    used_for: ["Pain relief", "Fever", "Heart attack prevention", "Stroke prevention", "Blood clot prevention"],
    how_it_works: "NSAID + antiplatelet: reduces inflammation, relieves pain, and prevents platelets from clumping together.",
    common_dosage: "Pain/fever: 325–650 mg every 4–6 hrs. Cardiac: 75–150 mg once daily (as prescribed).",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Stomach irritation", "Bleeding risk", "Tinnitus at high doses"],
    warnings: "Do not give to children under 16 (risk of Reye's syndrome). Avoid if on blood thinners.",
    consult_doctor_if: "You have stomach ulcers, bleeding disorders, or are on other anticoagulants.",
  }),
  thyronorm: med({
    name: "Thyronorm (Levothyroxine Sodium)", also_known_as: ["Eltroxin", "Thyrox", "Levothyroxine"], type: "Tablet",
    used_for: ["Hypothyroidism (underactive thyroid)", "Thyroid cancer (post-surgery)"],
    how_it_works: "Synthetic form of T4 hormone — replaces or supplements thyroid hormone the body cannot produce enough of.",
    common_dosage: "Taken on an empty stomach 30–60 min before breakfast; dose set by doctor based on TSH levels.",
    available_otc: false, prescription_required: true,
    common_side_effects: ["Palpitations if overdosed", "Weight loss", "Insomnia", "Sweating"],
    warnings: "Never stop suddenly. Dose must be adjusted by regular TSH blood tests.",
    consult_doctor_if: "You experience chest pain, rapid heartbeat, excessive sweating, or mood changes.",
  }),
  shelcal: med({
    name: "Shelcal (Calcium Carbonate 500 mg + Vitamin D3 250 IU)", also_known_as: ["Calcimax", "Calcium Sandoz", "Ostocalcium"], type: "Tablet",
    used_for: ["Calcium deficiency", "Osteoporosis", "Bone health", "Post-menopausal bone loss"],
    how_it_works: "Provides elemental calcium and Vitamin D3 needed for bone mineralisation and muscle function.",
    common_dosage: "1–2 tablets daily with or after meals.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Constipation", "Bloating", "Gas"],
    warnings: "Space doses 2 hours apart from thyroid medication or iron supplements.",
    consult_doctor_if: "You have kidney stones or kidney disease before starting calcium supplements.",
  }),
  digene: med({
    name: "Digene (Aluminium Hydroxide + Magnesium Hydroxide + Simethicone)", also_known_as: ["Gelusil", "Eno (different class)", "Mucaine"], type: "Tablet / Syrup / Gel",
    used_for: ["Acidity", "Heartburn", "Indigestion", "Bloating", "Gas"],
    how_it_works: "Antacid — neutralises excess stomach acid; simethicone breaks down gas bubbles.",
    common_dosage: "1–2 tablets or 10–20 ml syrup after meals and at bedtime.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Constipation (aluminium component)", "Loose stools (magnesium component)"],
    warnings: "Do not take with antibiotics or iron tablets simultaneously (reduces absorption).",
    consult_doctor_if: "Acidity persists for more than 2 weeks despite antacid use.",
  }),
  ondansetron: med({
    name: "Ondansetron", also_known_as: ["Emeset", "Vomistop", "Ondem", "Zofran"], type: "Tablet / Syrup / Injection",
    used_for: ["Nausea and vomiting", "Chemotherapy-induced nausea", "Post-surgery nausea"],
    how_it_works: "5-HT3 receptor antagonist — blocks serotonin signals in the gut and brain that trigger nausea.",
    common_dosage: "4–8 mg orally 30 min before trigger or as needed; max 3 doses/day.",
    available_otc: false, prescription_required: true,
    common_side_effects: ["Headache", "Constipation", "Warm/flushing sensation"],
    warnings: "Can cause QT prolongation — caution in heart patients and those on other QT-prolonging drugs.",
    consult_doctor_if: "You have heart rhythm problems or experience chest pain after taking it.",
  }),
  betadine: med({
    name: "Betadine (Povidone-Iodine)", also_known_as: ["Wokadine", "Poviiodine", "Iodine solution"], type: "Solution / Ointment / Scrub",
    used_for: ["Wound disinfection", "Skin antiseptic before surgery", "Minor cuts and abrasions", "Oral rinse"],
    how_it_works: "Releases free iodine that kills a broad range of bacteria, viruses, and fungi on contact.",
    common_dosage: "Apply diluted to wounds; use undiluted for surgical prep; follow label instructions.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Skin staining (temporary)", "Mild burning on open wounds"],
    warnings: "Do not use on newborns for extended periods. Avoid if allergic to iodine or thyroid conditions.",
    consult_doctor_if: "Wound shows signs of worsening infection — increased redness, pus, or fever.",
  }),
  ibuprofen: med({
    name: "Ibuprofen", also_known_as: ["Brufen", "Advil", "Nurofen", "Combiflam component"], type: "Tablet / Syrup",
    used_for: ["Pain relief", "Fever", "Inflammation", "Menstrual cramps", "Arthritis"],
    how_it_works: "NSAID — blocks COX enzymes that produce prostaglandins, reducing pain, fever, and inflammation.",
    common_dosage: "Adults: 200–400 mg every 4–6 hours with food; max 1200 mg/day OTC.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Stomach upset", "Nausea", "Heartburn", "Risk of gastric ulcer with prolonged use"],
    warnings: "Always take with food. Avoid in kidney disease, peptic ulcers, pregnancy (3rd trimester), or heart disease.",
    consult_doctor_if: "You have kidney/liver problems, are pregnant, or use blood thinners.",
  }),
  limcee: med({
    name: "Limcee (Vitamin C 500 mg — Chewable)", also_known_as: ["Celin", "Ascorbic Acid tablet", "C-500"], type: "Chewable Tablet",
    used_for: ["Vitamin C deficiency", "Boosting immunity", "Collagen synthesis", "Antioxidant support"],
    how_it_works: "Provides Vitamin C — an essential water-soluble antioxidant involved in immune function, iron absorption, and tissue repair.",
    common_dosage: "1 tablet daily; higher doses for deficiency as directed by doctor.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Stomach upset at high doses", "Diarrhoea"],
    warnings: "High doses (>2 g/day) can cause kidney stones in susceptible individuals.",
    consult_doctor_if: "You have a history of kidney stones or haemochromatosis (excess iron).",
  }),
  becosules: med({
    name: "Becosules (Vitamin B-Complex + Vitamin C)", also_known_as: ["B-Complex capsule", "Neurobion Forte"], type: "Capsule",
    used_for: ["B-vitamin deficiency", "Nerve health", "Energy metabolism", "Mouth ulcers", "General weakness"],
    how_it_works: "Provides all 8 B-vitamins (B1, B2, B3, B5, B6, B7, B9, B12) plus Vitamin C, which are co-factors in energy production and nerve function.",
    common_dosage: "1 capsule once or twice daily.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Urine turns bright yellow (harmless — excess B2)", "Mild nausea"],
    warnings: "Not a substitute for a balanced diet. Avoid megadosing B6 long-term (nerve damage risk).",
    consult_doctor_if: "Symptoms of deficiency (tingling, extreme fatigue) persist.",
  }),
  otrivin: med({
    name: "Otrivin (Xylometazoline 0.1%)", also_known_as: ["Nasivion", "Zylox", "Oxymetazoline"], type: "Nasal Drops / Nasal Spray",
    used_for: ["Nasal congestion", "Blocked nose", "Sinusitis", "Allergic rhinitis", "Common cold"],
    how_it_works: "Nasal decongestant — constricts blood vessels in the nasal passages, reducing swelling and congestion.",
    common_dosage: "2–3 drops or sprays in each nostril up to 3 times daily; use for max 5–7 days.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Nasal dryness", "Burning sensation", "Rebound congestion if overused"],
    warnings: "Do NOT use for more than 7 days — causes rebound congestion (rhinitis medicamentosa). Avoid in infants.",
    consult_doctor_if: "Congestion lasts more than 7 days or is accompanied by fever and facial pain.",
  }),
  soframycin: med({
    name: "Soframycin (Framycetin Sulphate 1%)", also_known_as: ["Framycetin cream", "Topical antibiotic"], type: "Cream / Ointment",
    used_for: ["Minor skin infections", "Infected wounds and cuts", "Burns", "Infected eczema"],
    how_it_works: "Topical aminoglycoside antibiotic — kills bacteria on the skin surface by disrupting their protein synthesis.",
    common_dosage: "Apply a thin layer to the affected area 2–3 times daily after cleaning.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Mild stinging", "Rare skin rash or allergy"],
    warnings: "For external use only. Do not use in the ear canal without doctor advice.",
    consult_doctor_if: "Infection worsens, spreads, or you develop a rash or fever.",
  }),
  ecosprin: med({
    name: "Ecosprin (Enteric-coated Aspirin 75 mg / 150 mg)", also_known_as: ["Loprin", "Cardioprin", "Aspirin-EC"], type: "Tablet (enteric-coated)",
    used_for: ["Prevention of heart attack", "Prevention of stroke", "Antiplatelet therapy"],
    how_it_works: "Low-dose aspirin irreversibly inhibits platelet aggregation, reducing clot formation in blood vessels.",
    common_dosage: "75–150 mg once daily with or after food (as prescribed for cardiac prevention).",
    available_otc: false, prescription_required: true,
    common_side_effects: ["GI bleeding risk", "Stomach irritation", "Bruising easily"],
    warnings: "Do not stop without doctor advice. Avoid in active peptic ulcer or if on other blood thinners.",
    consult_doctor_if: "You notice black stools, unusual bruising, or any active bleeding.",
  }),
  paracetamol: med({
    name: "Paracetamol (Acetaminophen)", also_known_as: ["Crocin", "Dolo 650", "Calpol", "Tylenol"], type: "Tablet / Syrup / Suppository",
    used_for: ["Fever", "Mild to moderate pain", "Headache", "Toothache", "Cold symptoms"],
    how_it_works: "Reduces fever via the brain's heat-regulation centre; relieves pain by elevating pain threshold.",
    common_dosage: "Adults: 500–1000 mg every 4–6 hours; max 4 g/day. Children: weight-based dosing.",
    available_otc: true, prescription_required: false,
    common_side_effects: ["Rare rash", "Nausea (uncommon at standard doses)"],
    warnings: "Overdose is the leading cause of acute liver failure — never exceed 4 g/day. Avoid alcohol.",
    consult_doctor_if: "Fever persists beyond 3 days, pain is severe, or you have liver disease.",
  }),
};

const MEDICINE_ALIASES: Record<string, string> = {
  "i-pill": "ipill", "i pill": "ipill",
  unwanted72: "unwanted 72", "unwanted-72": "unwanted 72",
  dolo: "dolo 650", dolo650: "dolo 650",
  "crocin 500": "crocin", "crocin 650": "dolo 650",
  acetaminophen: "paracetamol",
  glycomet: "metformin", glucophage: "metformin",
  azithral: "azithromycin", zithromax: "azithromycin",
  novamox: "amoxicillin", amoxil: "amoxicillin", augmentin: "amoxicillin",
  "pan 40": "pantoprazole", "pan d": "pantoprazole", pantocid: "pantoprazole",
  cetrizine: "cetirizine", cetzine: "cetirizine", zyrtec: "cetirizine",
  "monte lc": "montair lc", "montek lc": "montair lc",
  ecosprin: "ecosprin", loprin: "ecosprin",
  eltroxin: "thyronorm", levothyroxine: "thyronorm", thyrox: "thyronorm",
  calcimax: "shelcal", "calcium carbonate": "shelcal",
  gelusil: "digene", eno: "digene",
  emeset: "ondansetron", vomistop: "ondansetron", ondem: "ondansetron",
  wokadine: "betadine", "povidone iodine": "betadine",
  brufen: "ibuprofen", advil: "ibuprofen", nurofen: "ibuprofen",
  celin: "limcee", "vitamin c": "limcee",
  neurobion: "becosules", "b complex": "becosules",
  nasivion: "otrivin", xylometazoline: "otrivin",
  framycetin: "soframycin",
  combiflam: "combiflam",
  aspirin: "aspirin", disprin: "aspirin",
};

// ── Intent detection ──────────────────────────────────────────────────────
const PHARMA_SUFFIX_PAT =
  /(mycin|cillin|oxacin|cycline|prazole|sartan|statin|formin|dipine|parin|olol|pride|gliptin|floxacin|azole|vir|mab|nib|tinib|zumab|ximab|umab|parib|ciclib|rafenib|setron|triptan|lukast|cortisone|steroid|phenol|barbital|diazepam|zolam|zepam)$/i;

const NON_MEDICINE_TERMS = new Set<string>([
  "condom", "female condom", "contraceptive", "diaphragm",
  "iud", "intrauterine device", "copper t", "copper-t",
  "sanitary pad", "tampon", "menstrual cup", "sanitary napkin", "pad", "napkin", "diaper",
  "thermometer", "glucometer", "oximeter", "pulse oximeter",
  "blood pressure monitor", "bp machine", "stethoscope",
  "syringe", "needle", "insulin pump", "hearing aid", "nebulizer",
  "bandage", "gauze", "plaster", "band aid", "cotton",
  "pregnancy test", "pregnancy kit", "urine test", "blood test",
  "mri", "ct scan", "x-ray", "xray", "ultrasound", "sonography",
  "ecg", "eeg", "biopsy", "endoscopy",
  "diabetes", "hypertension", "cancer", "asthma", "arthritis",
  "acidity", "fever", "cold", "flu", "surgery", "operation",
  "vaccination", "vaccine", "immunity",
  "calorie", "protein", "carbohydrate", "fat", "fibre",
  "vitamin", "mineral", "supplement",
  "blood group", "cholesterol", "bmi",
]);

const MEDICINE_QUERY_PATS =
  /\b(what is|tell me about|info on|information about|uses of|use of|side effects of|dosage of|how to use|can i take|is it safe to take|kya hai|kya hota hai|kab lete hain|kaise lete hain|kitni dose)\b/i;
const QUERY_PREFIX_PAT =
  /^\s*(what is|tell me about|info on|information about|uses of|use of|side effects of|dosage of|how to use|can i take|is it safe to take|kya hai|kya hota hai|kab lete hain|kaise lete hain|kitni dose)\s*/i;
const QUERY_SUFFIX_PAT =
  /\s*(tablet|tablets|capsule|capsules|syrup|injection|cream|ointment|drops|uses|use|dose|dosage|mg|mcg|ml|side effect|side effects|information|info|details|kya hai)\s*$/i;
const SYMPTOM_DISQUALIFIERS =
  /\b(doctor|specialist|hospital|clinic|appointment|near me|nearby|pain|ache|fever|symptoms|symptom|treatment|cure|mujhe|mera|ho rha|bukhar|khansi|dard|jalan|sujan|khujli)\b/i;

function extractMedicineSubject(text: string): string {
  return text.replace(QUERY_PREFIX_PAT, "").trim().replace(QUERY_SUFFIX_PAT, "").trim();
}

function looksLikeMedicine(word: string): boolean {
  if (KNOWN_MEDICINES.has(word) || word in MEDICINE_ALIASES) return true;
  return PHARMA_SUFFIX_PAT.test(word);
}

export function isMedicineQuery(message: string): boolean {
  const text = message.trim().toLowerCase();
  const words = text.split(/\s+/);

  if (SYMPTOM_DISQUALIFIERS.test(text)) return false;

  const subject = extractMedicineSubject(text);
  if (NON_MEDICINE_TERMS.has(subject)) return false;

  if (MEDICINE_QUERY_PATS.test(text)) return looksLikeMedicine(subject);

  if (words.length <= 6) {
    if (KNOWN_MEDICINES.has(text) || text in MEDICINE_ALIASES) return true;
    if (KNOWN_MEDICINES.has(subject) || subject in MEDICINE_ALIASES) return true;
    for (const m of KNOWN_MEDICINES) if (text.includes(m)) return true;
    const hasPharmaCtx =
      /\b(tablet|capsule|syrup|injection|cream|ointment|drops|uses|use|dose|dosage|mg|mcg|ml|side effect)\b/.test(text);
    if (hasPharmaCtx && looksLikeMedicine(subject)) return true;
  }
  return false;
}

function resolveMedicineName(raw: string): string {
  let clean = raw.trim().toLowerCase();
  clean = clean
    .replace(
      /\b(tablet|capsule|syrup|injection|cream|ointment|drops|uses|use|dosage|dose|mg|mcg|ml|side effect|side effects|what is|tell me about|info on|information about|uses of|kya hai)\b/gi,
      ""
    )
    .trim();
  if (clean in MEDICINE_ALIASES) return MEDICINE_ALIASES[clean];
  return clean;
}

// ── Lookup with cache → Gemini → built-in DB → generic ────────────────────
const MEDICINE_CACHE = new Map<string, { ts: number; val: MedicineInfo }>();
const MEDICINE_CACHE_TTL = 3600 * 1000;

function cacheGet(key: string): MedicineInfo | null {
  const e = MEDICINE_CACHE.get(key);
  if (e) {
    if (Date.now() - e.ts < MEDICINE_CACHE_TTL) return e.val;
    MEDICINE_CACHE.delete(key);
  }
  return null;
}
function cacheSet(key: string, val: MedicineInfo): void {
  if (MEDICINE_CACHE.size > 300) MEDICINE_CACHE.delete(MEDICINE_CACHE.keys().next().value as string);
  MEDICINE_CACHE.set(key, { ts: Date.now(), val });
}

const MEDICINE_GEMINI_PROMPT = (medicineName: string) =>
  `You are a medical information assistant for Doctar.in, an Indian healthcare platform.
When given a medicine name, respond ONLY in the following JSON format with no extra text or markdown:

{
  "name": "Official medicine name",
  "also_known_as": ["brand1", "brand2"],
  "type": "Tablet / Syrup / Injection / Cream etc.",
  "used_for": ["condition 1", "condition 2", "condition 3"],
  "how_it_works": "One line plain English explanation",
  "common_dosage": "Standard dosage info",
  "available_otc": true or false,
  "prescription_required": true or false,
  "common_side_effects": ["side effect 1", "side effect 2"],
  "warnings": "Key warning in one line",
  "consult_doctor_if": "When to see a doctor",
  "disclaimer": "This is for informational purposes only. Always consult a doctor or pharmacist before taking any medicine."
}

Focus on Indian brand names and Indian healthcare context. Be accurate, concise and safe.
Do not recommend dosages beyond standard guidelines. Always include the disclaimer exactly as shown.

Medicine to look up: ${medicineName}`;

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={key}";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lookupViaGemini(medicineName: string): Promise<MedicineInfo | null> {
  if (!settings.geminiApiKey) return null;
  const url = GEMINI_URL.replace("{key}", settings.geminiApiKey);
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: MEDICINE_GEMINI_PROMPT(medicineName) }]}],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        if ((resp.status === 429 || resp.status === 503) && attempt === 0) {
          await sleep(1000);
          continue;
        }
        console.warn(`Gemini medicine lookup HTTP error ${resp.status} for ${medicineName}`);
        return null;
      }
      const data: any = await resp.json();
      let raw = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
      raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) raw = match[0];
      const result = JSON.parse(raw);
      console.log(`Gemini medicine lookup OK: ${medicineName}`);
      return result;
    } catch (e) {
      clearTimeout(timer);
      console.warn(`Gemini medicine lookup failed for ${medicineName}: ${(e as Error).message}`);
      return null;
    }
  }
  return null;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

export async function lookupMedicine(rawQuery: string): Promise<MedicineInfo> {
  const key = rawQuery.trim().toLowerCase();
  const cached = cacheGet(key);
  if (cached) return cached;

  const medicineKey = resolveMedicineName(rawQuery);

  // 1. Built-in DB
  const dbEntry = MEDICINE_DB[medicineKey];
  if (dbEntry) {
    cacheSet(key, dbEntry);
    return dbEntry;
  }

  // 2. Alias → built-in DB
  const aliasKey = MEDICINE_ALIASES[medicineKey];
  if (aliasKey) {
    const aliased = MEDICINE_DB[aliasKey];
    if (aliased) {
      cacheSet(key, aliased);
      return aliased;
    }
  }

  // 3. Gemini real-time lookup
  const geminiResult = await lookupViaGemini(medicineKey);
  if (geminiResult) {
    cacheSet(key, geminiResult);
    return geminiResult;
  }

  // 4. Generic fallback
  const fallback: MedicineInfo = {
    name: titleCase(medicineKey),
    also_known_as: [],
    type: "Unknown",
    used_for: ["Please consult a pharmacist or doctor for details about this medicine."],
    how_it_works: "Information not available in our current database.",
    common_dosage: "Please follow your doctor's or pharmacist's instructions.",
    available_otc: null,
    prescription_required: null,
    common_side_effects: [],
    warnings: "Always read the medicine label and consult a doctor or pharmacist before use.",
    consult_doctor_if: "You have any doubts about this medicine or experience unexpected symptoms.",
    disclaimer: "This is for informational purposes only. Always consult a doctor or pharmacist before taking any medicine.",
  };
  cacheSet(key, fallback);
  return fallback;
}
