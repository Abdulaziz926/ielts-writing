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
    const minWords  = taskNumber === 1 ? 150 : 250;
    const belowMin  = wordCount < minWords;

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
      required: ["ta_label","ta_score","ta_feedback","cc_score","cc_feedback","lr_score",
                 "lr_feedback","gra_score","gra_feedback","overall","summary",
                 "strengths","improvements","corrected_example","fact_errors"]
    };

    // Serialise built-in chart data for fact-checking
    function chartToText(cd) {
      if (!cd) return "";
      if (cd.type === "doughnut")
        return "\nCHART DATA:\n" + cd.labels.map((l,i)=>`${l}: ${cd.values[i]}%`).join(" | ") + "\n";
      const rows = cd.labels.map((lab,i)=>
        lab + ": " + cd.series.map(s=>s.name+"="+s.values[i]).join(", ")
      ).join(" | ");
      return `\nCHART DATA (${cd.title}, ${cd.type}): ${rows}\n`;
    }
    const chartText = chartToText(chartData);

    const taLabel = taskNumber === 1 ? "Task Achievement" : "Task Response";

    const BANDS = taskNumber === 1 ? `
TASK 1 BAND ANCHORS (Task Achievement / Coherence&Cohesion / Lexical Resource / Grammar):
9: Fully satisfies all requirements; effortless cohesion; full LR flexibility; virtually error-free.
8: All requirements covered with minor omissions; well-managed cohesion; wide LR; majority error-free sentences.
7: Requirements covered; clear overview; some omissions/CC inaccuracies; good LR; mix of simple+complex grammar.
6: Task generally addressed; overview partly lacking or inaccurate detail; adequate LR; complex attempts often faulty.
5: Mechanical/list-like; key features partially covered; limited CC; limited LR; frequent grammar errors.
4: Minimal attempt; key features mostly missing/wrong; no overview; very limited range; errors distort meaning.
3: Does not adequately address task; largely missing key features; errors predominate.
0: Random characters / blank / wholly unrelated / no rateable English language — ALL scores = 0.` : `
TASK 2 BAND ANCHORS:
9: All parts fully addressed; fully developed position; wide range; virtually error-free.
8: All parts sufficiently addressed; well-developed ideas; wide range; mostly error-free.
7: All parts addressed (some more fully); clear position; good range; some CC/grammar inaccuracies.
6: All parts addressed though some underdeveloped; adequate range; complex structures often faulty.
5: Task partially addressed; position unclear; limited range; frequent grammar errors.
4: Minimal/misunderstood response; few undeveloped ideas; very limited range; errors distort meaning.
3: Does not address any part adequately; no clear position; errors predominate.
0: Random characters / blank / wholly unrelated / no rateable English — ALL scores = 0.`;

    const FACTCHECK = taskNumber === 1 ? `
FACT-CHECK RULE (Task 1 only): Judge like a human examiner, NOT an OCR tool.
Accept reasonable approximations ("about 45", "roughly 20,000", "just under"). 
Only add to fact_errors when: trend direction is wrong, ranking/comparison is wrong, data is invented, or estimate is wildly inconsistent. Empty array [] if no genuine errors.` : `
fact_errors must be [] for Task 2.`;

    const prompt = `You are a strict, certified IELTS examiner (20+ years). NEVER inflate scores. NEVER reward fluency if task is inaccurate. If between two bands, choose the lower band.

CANDIDATE: ${userName}
TASK ${taskNumber} QUESTION: ${taskQuestion}${chartText}
RESPONSE (${wordCount}/${minWords} words${belowMin?" — BELOW MINIMUM, penalise "+taLabel:""}):
${userResponse}
${BANDS}
${FACTCHECK}

SCORING SCALE: half-bands only — 0,1,2,3,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9
overall = mean of 4 scores rounded to nearest 0.5.

FEEDBACK RULES (mandatory for each field):
- Quote 1-2 actual phrases from the response as evidence.
- Name specific error patterns (e.g. missing articles, run-on sentences, overuse of "however").
- Match each score to the exact band anchor wording above.
- summary: 3-4 professional examiner sentences stating why this band was given and what blocks the next band.
- strengths: 2-3 evidence-based points quoting actual phrases.
- improvements: 2-3 concrete, actionable improvements.
- corrected_example: ONE sentence from the response → BEFORE: [quote] → AFTER: [fixed] — explain why.
- ta_label must be exactly "${taLabel}".`;

    let parts;
    if (taskImage) {
      const base64 = taskImage.includes(",") ? taskImage.split(",")[1] : taskImage;
      const mime   = taskImageType || "image/jpeg";
      parts = [
        { text: prompt + "\n\nThe attached image is the Task 1 chart/graph/diagram. Analyse it first, then score." },
        { inline_data: { mime_type: mime, data: base64 } }
      ];
    } else {
      parts = [{ text: prompt }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    async function callGemini() {
      const res  = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          contents:         [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema:   jsonSchema,
            temperature:      0.3,
            maxOutputTokens:  2048
          }
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Gemini API xatosi");
      const cand = data.candidates?.[0];
      if (!cand?.content?.parts?.[0])
        throw new Error("Gemini bo'sh javob (sabab: " + (cand?.finishReason || "noma'lum") + ")");
      return JSON.parse(cand.content.parts[0].text);
    }

    let scoreData;
    try            { scoreData = await callGemini(); }
    catch (e)      { console.error("Retry:", e.message); scoreData = await callGemini(); }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: scoreData }) };

  } catch (err) {
    console.error("Error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
