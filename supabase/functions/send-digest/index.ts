import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return await res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { digestType } = await req.json();

    // Get all users who have digest configured
    const { data: allConfigs } = await supabase
      .from("config")
      .select("user_id, key, value")
      .eq("key", "DIGEST_EMAIL");

    if (!allConfigs || allConfigs.length === 0) {
      return new Response(JSON.stringify({ message: "No digest emails configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];

    for (const cfg of allConfigs) {
      const userId = cfg.user_id;
      const digestEmail = cfg.value as string;

      // Generate digest content
      const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-digest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ digestType, userId }),
      });

      const genData = await genRes.json();
      if (genData.skipped || genData.error) {
        results.push({ userId, skipped: true, reason: genData.reason || genData.error });
        continue;
      }

      // Get user's Google calendar token to send via Gmail
      const { data: tokenData } = await supabase
        .from("calendar_tokens")
        .select("*")
        .eq("user_id", userId)
        .eq("provider", "google")
        .single();

      if (!tokenData) {
        results.push({ userId, error: "No Google token found" });
        continue;
      }

      let accessToken = tokenData.access_token;
      // Refresh if expired
      if (new Date(tokenData.expires_at) < new Date()) {
        const refreshed = await refreshAccessToken(tokenData.refresh_token);
        if (refreshed) {
          accessToken = refreshed.access_token;
          await supabase.from("calendar_tokens").update({
            access_token: refreshed.access_token,
            expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          }).eq("id", tokenData.id);
        } else {
          results.push({ userId, error: "Failed to refresh token" });
          continue;
        }
      }

      // Send email via Gmail API
      const emailContent = [
        `To: ${digestEmail}`,
        `Subject: ${genData.subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        genData.html,
      ].join("\r\n");

      const base64Email = btoa(unescape(encodeURIComponent(emailContent)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: base64Email }),
      });

      if (gmailRes.ok) {
        results.push({ userId, sent: true, to: digestEmail });
      } else {
        const errText = await gmailRes.text();
        console.error("Gmail send error:", errText);
        results.push({ userId, error: "Gmail send failed", detail: errText });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-digest error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
