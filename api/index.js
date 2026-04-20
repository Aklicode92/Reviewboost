const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/generate-form", async (req, res) => {
  const { description } = req.body;
  if (!description) return res.status(400).json({ error: "Beskrivning krävs" });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `Du är en expert på kundundersökningar. Baserat på denna företagsbeskrivning, generera exakt 10 relevanta frågor för en kundundersökning.

Företag: "${description}"

Regler:
- Exakt 10 frågor, anpassade specifikt för denna bransch
- På svenska
- Variera fälttyper genomtänkt:
  * "stars" = stjärnbetyg 1-5 (använd för helhetsbetyg och kvalitetsfrågor)
  * "textarea" = fritextsvar (använd för öppna frågor som "vad kan vi förbättra?")
  * "radio" = välj ett alternativ (använd för specifika frågor med tydliga alternativ, max 4 alternativ)
  * "yesno" = Ja/Nej (använd för enkla ja/nej-frågor)
- Börja med en stjärnfråga om helhetsintryck
- Avsluta alltid med "Skulle du rekommendera oss till andra?" med typ "yesno"
- Svara ENDAST med JSON (inga kodblock, ingen annan text):
{
  "questions": [
    {"question": "frågetext", "type": "stars"},
    {"question": "frågetext", "type": "textarea"},
    {"question": "frågetext", "type": "radio", "options": ["Alt 1", "Alt 2", "Alt 3"]},
    {"question": "Skulle du rekommendera oss till andra?", "type": "yesno"}
  ]
}`,
        }],
      }),
    });
    const data = await response.json();
    const raw = data.content[0].text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Kunde inte generera formulär" });
  }
});

app.post("/api/forms", async (req, res) => {
  const { business_description, questions, google_link } = req.body;
  if (!questions || !google_link) return res.status(400).json({ error: "Frågor och Google-länk krävs" });
  const { data, error } = await supabase
    .from("forms")
    .insert([{ business_description, questions, google_link }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/forms/:id", async (req, res) => {
  const { data, error } = await supabase.from("forms").select("*").eq("id", req.params.id).single();
  if (error) return res.status(404).json({ error: "Formulär hittades inte" });
  res.json(data);
});

app.get("/api/forms", async (req, res) => {
  const { data, error } = await supabase.from("forms").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/responses", async (req, res) => {
  const { form_id, answers } = req.body;
  if (!form_id || !answers) return res.status(400).json({ error: "form_id och answers krävs" });
  const { data: form } = await supabase.from("forms").select("*").eq("id", form_id).single();
  if (!form) return res.status(404).json({ error: "Formulär hittades inte" });

  let isPositive = false, aiReason = "";
  try {
    const answersText = Object.entries(answers).map(([q, a]) => `Fråga: ${q}\nSvar: ${a}`).join("\n\n");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [{ role: "user", content: `Analysera dessa kundsvar och avgör om feedbacken är övervägande positiv eller negativ.\n\n${answersText}\n\nSvara ENDAST med JSON (inga kodblock): {"positive": true/false, "reason": "max 12 ord på svenska"}` }],
      }),
    });
    const data = await response.json();
    const raw = data.content[0].text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    isPositive = parsed.positive;
    aiReason = parsed.reason;
  } catch { isPositive = true; aiReason = "Kunde inte analysera"; }

  const { error } = await supabase.from("responses").insert([{ form_id, answers, is_positive: isPositive, ai_reason: aiReason }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ positive: isPositive, reason: aiReason, google_link: form.google_link });
});

app.delete("/api/forms/:id", async (req, res) => {
  const { error } = await supabase.from("forms").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server kör på port ${PORT}`));
module.exports = app;