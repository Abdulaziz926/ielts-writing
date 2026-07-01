exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { taskNumber, taskQuestion, userResponse, userName, taskImage, taskImageType, chartData } = JSON.parse(event.body);
    const wordCount = userResponse.trim().split(/\s+/).filter(w => w.length > 0).length;
    const minWords = taskNumber === 1 ? 150 : 250;
    const belowMin = wordCount < minWords;

    const jsonSchema = {
      type: "object",
      properties: {
        ta_label:          { type: "string" },
        ta_score:          { type: "number" },
        ta_feedback:       { type: "string" },
        cc_score:          { type: "number" },
        cc_feedback:       { type: "string" },
        lr_score:          { type: "number" },
        lr_feedback:       { type: "string" },
        gra_score:         { type: "number" },
        gra_feedback:      { type: "string" },
        overall:           { type: "number" },
        summary:           { type: "string" },
        strengths:         { type: "array", items: { type: "string" } },
        improvements:      { type: "array", items: { type: "string" } },
        corrected_example: { type: "string" },
        fact_errors:       { type: "array", items: { type: "string" } }
      },
      required: ["ta_label","ta_score","ta_feedback","cc_score","cc_feedback","lr_score","lr_feedback","gra_score","gra_feedback","overall","summary","strengths","improvements","corrected_example","fact_errors"]
    };

    // ── Serialise built-in chart data so Gemini can fact-check every figure ──
    function buildChartText(cd) {
      if (!cd) return "";
      if (cd.type === "doughnut") {
        return `\n=== EXACT CHART DATA ===\nTitle: ${cd.title}\nType: pie/doughnut\n` +
          cd.labels.map((l,i) => `${l}: ${cd.values[i]}%`).join("\n") + "\n=========================\n";
      }
      const header = ["Category".padEnd(14), ...cd.series.map(s => s.name)].join(" | ");
      const rows   = cd.labels.map((lab,i) =>
        [String(lab).padEnd(14), ...cd.series.map(s => s.values[i])].join(" | ")
      ).join("\n");
      return `\n=== EXACT CHART DATA ===\nTitle: ${cd.title}\nType: ${cd.type}\nX-axis: ${cd.xLabel} | Y-axis: ${cd.yLabel}\n${header}\n${rows}\n=========================\n`;
    }
    const chartText = buildChartText(chartData);

    // ══════════════════════════════════════════════════════════════════════
    //  MASTER EXAMINER PROMPT  (based on official IELTS band descriptors)
    // ══════════════════════════════════════════════════════════════════════
    const ROLE = `
ROLE
You are a certified senior IELTS Writing examiner with over 20 years of examining experience.
Your evaluation standard MUST follow the official IELTS Writing Band Descriptors published by Cambridge, the British Council and IDP.
You NEVER behave like a generic AI writing scorer.
You NEVER inflate scores.
You NEVER reward sophisticated vocabulary if the task itself is inaccurate.
You ALWAYS behave exactly like a trained IELTS examiner.
Your only objective is to produce the most accurate IELTS score possible.

SCORING POLICY
- Use ONLY official IELTS descriptors.
- If between two bands, choose the LOWER band unless there is strong evidence for the higher band.
- Accuracy is more important than vocabulary complexity.
- Never reward memorised phrases or forced vocabulary.
- Do NOT score based on vocabulary or grammar alone.
- Do NOT ignore factual inaccuracies or a missing overview.
- Do NOT over-score essays that simply sound fluent.
- Do NOT under-score essays with simple but accurate English.
- Many AI writing evaluators are far too generous — do NOT imitate them.

GRAMMAR POLICY
Never reward complexity if it reduces accuracy. A candidate using simple but accurate grammar often deserves a higher score than one attempting complex structures with many errors.

VOCABULARY POLICY
Penalise: forced vocabulary, incorrect collocations, unnatural academic phrases, repetition, word-form mistakes. Do NOT reward uncommon vocabulary unless it is natural and precise.

COHERENCE POLICY
Check that every paragraph has one clear purpose, logical progression, appropriate linking, and natural cohesion. Do NOT reward excessive linking words — too many connectors reduce naturalness.

SCORING SCALE — half-bands only: 0, 1, 2, 3, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9
overall = arithmetic mean of the four criteria scores, rounded to the nearest 0.5.

Band 0: No rateable language (random characters, blank, wholly unrelated text, memorised script disconnected from the task). Set ALL scores to 0. strengths = ["None — no valid attempt was made"].
Band 1: Response of 20 words or fewer, or wholly unrelated to the task.
Band 2: Content barely relates to the task.
Band 3: Does not adequately address requirements; errors predominate; severely limited.
Band 4: Minimal/wrong response; very limited range; frequent errors that distort meaning.
Band 5: Partial/mechanical response; limited range; frequent errors causing strain.
Band 6: Generally adequate; noticeable errors; task mostly addressed.
Band 7: Good; some errors; adequately organised; good range.
Band 8: Very good; rare slips; well-organised; wide range.
Band 9: Expert; virtually error-free; full coverage; wide range.

WORD COUNT: ${wordCount} / minimum ${minWords}${belowMin ? ` ⚠️ BELOW MINIMUM — penalise Task ${taskNumber===1?"Achievement":"Response"} for this` : ""}.`;

    const T1_PROCESS = `
TASK 1 EVALUATION PROCESS

STEP 1 — READ THE VISUAL (chart data provided below if built-in)
Identify: main trend, highest, lowest, largest/smallest increase, any exceptions, outliers, and the essential overview.

STEP 2 — CHECK THE OVERVIEW
Does the essay contain an overview covering ALL major features? If the overview is missing or wrong, Task Achievement CANNOT exceed Band 5.

STEP 3 — SENTENCE-BY-SENTENCE FACT CHECK
Check every number, comparison, trend, ranking, percentage, increase, decrease, maximum, minimum, and overview statement.
Accept reasonable approximations: "about 45,000", "roughly", "just under/over", "approximately", "around" — these are NOT errors.
Only flag as an error when an estimate clearly changes the comparison, trend, ranking, or meaning. Never penalise visual estimation when exact values are not grid-readable.
For each genuine factual error, include in fact_errors: one sentence stating what the candidate claimed and what the chart actually shows.
If there are no genuine errors, return an empty array [].

STEP 4 — ORGANISATION
Check: logical grouping of data, paragraphing, clear progression, appropriate referencing and cohesion.

STEP 5 — VOCABULARY
Natural? Academic? Repeated words? Incorrect collocations? Formal register?

STEP 6 — GRAMMAR
Sentence variety, accuracy of articles/prepositions/verb tense, relative clauses, complex sentences, punctuation, agreement.

STEP 7 — ASSIGN BANDS independently for each of the four criteria.

OFFICIAL TASK 1 BAND DESCRIPTORS:
Band 9 TA: fully and appropriately satisfies all requirements; extremely rare minor lapses only.
Band 8 TA: covers all requirements; key features skilfully selected and clearly presented; only occasional minor omissions.
Band 7 TA: covers requirements; key features highlighted with clear overview; data appropriately categorised; a few omissions.
Band 6 TA: focuses on task with appropriate format; key features highlighted but overview may be partly lacking; some irrelevant/inaccurate detail.
Band 5 TA: generally addresses requirements but may be mechanical; key features not always fully covered; recounting lacks data support.
Band 4 TA: minimal attempt; key features missing or wrongly selected; little/no overview; format often inappropriate.
Band 3 TA: does not adequately address requirements; key features largely missing or only briefly mentioned.

Band 9 CC: message follows effortlessly; cohesion unnoticeable; paragraphing skilful.
Band 8 CC: logically sequenced; cohesion well-managed; occasional minor lapses; good paragraphing.
Band 7 CC: logically organised with clear progression; some inaccuracy/over-use of cohesive devices.
Band 6 CC: organisation evident but not wholly logical; ideas followable but not always fluently linked.
Band 5 CC: tendency to list details without overall picture; limited/inaccurate cohesive devices.
Band 4 CC: little logical organisation; minimal/mechanical cohesion; little/no paragraphing.

Band 9 LR: full flexibility, precise and natural vocabulary; extremely rare minor slips.
Band 8 LR: wide resource used fluently; skilful use of less common items; occasional inaccuracies barely affecting meaning.
Band 7 LR: sufficient range for flexibility; some less-common items; few spelling/word-form errors.
Band 6 LR: generally adequate; meaning clear despite imprecision; some spelling errors that don't impede communication.
Band 5 LR: limited range; repetitive vocabulary; noticeable errors causing strain.
Band 4 LR: inadequate vocabulary; noticeable disruptive errors.

Band 9 GRA: wide range of structures with full flexibility and control; virtually error-free.
Band 8 GRA: wide range; majority of sentences error-free; only occasional non-systematic errors.
Band 7 GRA: mix of simple and complex sentences; complex ones less accurate; errors rarely impede communication.
Band 6 GRA: limited and repetitive; complex attempts often faulty; frequent errors may cause difficulty; punctuation may be faulty.
Band 5 GRA: limited range attempted; frequent errors sometimes impeding understanding.
Band 4 GRA: very limited range; rare correct complex attempts; frequent errors may distort meaning.`;

    const T2_PROCESS = `
TASK 2 EVALUATION PROCESS

STEP 1 — READ THE QUESTION
Identify: topic, task type (opinion / discussion / advantages / problems / double question / solution), all parts of the task.
If one part is missing → Task Response CANNOT exceed Band 5.

STEP 2 — CHECK
Position clarity, development of all main ideas, quality of examples and support, relevance, logic, and paragraphing with clear topic sentences.

STEP 3 — VOCABULARY, GRAMMAR, COHERENCE (same standards as Task 1 above).

STEP 4 — ASSIGN BANDS independently for each criterion.

OFFICIAL TASK 2 BAND DESCRIPTORS:
Band 9 TR: fully and appropriately addresses all parts; fully developed position with well-supported, relevant, extended ideas.
Band 8 TR: sufficiently addresses all parts; well-developed with relevant, extended and well-supported ideas.
Band 7 TR: addresses all parts (some more fully than others); clear overall position throughout; main ideas extended and supported but may over-generalise.
Band 6 TR: addresses all parts though some may be more fully covered; relevant position but conclusions may become unclear/repetitive; main ideas presented but some underdeveloped.
Band 5 TR: addresses task only partially; position unclear or repetitive; main ideas limited, not well developed; may include irrelevant detail.
Band 4 TR: responds minimally or task is misunderstood; position unclear; few ideas, largely undeveloped or irrelevant.
Band 3 TR: does not adequately address any part; no clear position; little/no relevant evidence.

(CC, LR, GRA descriptors are identical to Task 1 above.)

fact_errors must be an empty array [] for Task 2.`;

    const FEEDBACK_RULES = `
FEEDBACK QUALITY RULES (mandatory)
Each of the four feedback fields (ta_feedback, cc_feedback, lr_feedback, gra_feedback) MUST:
1. Quote or closely paraphrase 1–2 actual phrases/sentences the candidate wrote.
2. Name the specific grammatical structures, vocabulary items, or cohesive devices used (or missing).
3. Identify concrete, recurring error patterns (e.g. article omission, subject-verb disagreement, run-on sentences, overuse of "however", informal register) — never vague statements like "some errors occur".
4. Justify the score with the specific band descriptor wording it matches.

summary: write 3–4 sentences as a professional IELTS examiner would — objective, evidence-based, explaining exactly why this band was awarded and what the main barrier to the next band is.
strengths: 2–3 specific, evidence-based strengths (quote actual phrases when possible).
improvements: 2–3 most impactful, concrete improvements with specific guidance.
corrected_example: take ONE sentence from the response with an error, show BEFORE → AFTER, explain why in one sentence.`;

    let parts;

    if (taskImage) {
      const base64 = taskImage.includes(",") ? taskImage.split(",")[1] : taskImage;
      const mime   = taskImage.Type || "image/jpeg";
      parts = [
        { text: `${ROLE}\n\n${T1_PROCESS}\n\n${FEEDBACK_RULES}\n\nCANDIDATE: ${userName}\nRESPONSE (${wordCount} words):\n${userResponse}\n\nThe attached image is the IELTS Writing Task 1 chart/graph/diagram/map. Analyse it carefully before scoring. ta_label must be exactly "Task Achievement".` },
        { inline_data: { mime_type: mime, data: base64 } }
      ];
    } else {
      const process = taskNumber === 1 ? T1_PROCESS : T2_PROCESS;
      const taLabel  = taskNumber === 1 ? "Task Achievement" : "Task Response";
      parts = [{ text: `${ROLE}\n\n${process}\n\n${FEEDBACK_RULES}\n\nCANDIDATE: ${userName}\nTASK QUESTION:\n${taskQuestion}\n${chartText}\nRESPONSE (${wordCount} words):\n${userResponse}\n\nta_label must be exactly "${taLabel}".` }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    async function callGemini() {
      const res  = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          contents:       [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema:   jsonSchema,
            temperature:      0.3,
            maxOutputTokens:  4096
          }
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Gemini API xatosi");
      const cand = data.candidates?.[0];
      if (!cand?.content?.parts?.[0]) throw new Error("Gemini bo'sh javob qaytardi (sabab: " + (cand?.finishReason || "noma'lum") + ")");
      return JSON.parse(cand.content.parts[0].text);
    }

    let scoreData;
    try            { scoreData = await callGemini(); }
    catch (e)      { console.error("1st attempt failed:", e.message); scoreData = await callGemini(); }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: scoreData }) };

  } catch (err) {
    console.error("Handler error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
