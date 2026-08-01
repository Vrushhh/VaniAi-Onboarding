import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/telephony/test-connection")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { provider, accountSid, authToken, orgId } = body;

          let targetProvider = provider;
          let targetSid = accountSid;
          let targetToken = authToken;

          // 1. Fetch saved credentials from database using admin client if orgId is provided
          if (orgId) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: config, error: configErr } = await (supabaseAdmin as any)
              .from("telephony_config")
              .select("provider, account_sid, auth_token")
              .eq("org_id", orgId)
              .maybeSingle();

            if (configErr || !config) {
              return new Response(
                JSON.stringify({ ok: false, error: "Telephony configuration not found for this organization." }),
                { status: 404, headers: { "Content-Type": "application/json" } }
              );
            }
            targetProvider = config.provider;
            targetSid = config.account_sid;
            targetToken = config.auth_token;
          }

          if (!targetProvider || !targetSid || !targetToken) {
            return new Response(
              JSON.stringify({ ok: false, error: "Missing telephony provider credentials." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          // 2. Perform base64 authentication
          const credentials = btoa(`${targetSid}:${targetToken}`);
          const authHeader = `Basic ${credentials}`;

          let responseOk = false;
          let errorMessage = "";

          if (targetProvider === "exotel") {
            // Exotel Account Details URL (returns JSON)
            const url = `https://api.exotel.com/v1/Accounts/${targetSid}.json`;
            const res = await fetch(url, {
              method: "GET",
              headers: {
                Authorization: authHeader,
              },
            });
            responseOk = res.ok;
            if (!res.ok) {
              errorMessage = `Exotel returned status: ${res.status}`;
            }
          } else if (targetProvider === "plivo") {
            // Plivo Account Details URL
            const url = `https://api.plivo.com/v1/Account/${targetSid}/`;
            const res = await fetch(url, {
              method: "GET",
              headers: {
                Authorization: authHeader,
              },
            });
            responseOk = res.ok;
            if (!res.ok) {
              errorMessage = `Plivo returned status: ${res.status}`;
            }
          } else {
            return new Response(
              JSON.stringify({ ok: false, error: "Invalid telephony provider." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          return new Response(
            JSON.stringify({ ok: responseOk, error: errorMessage || undefined }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        } catch (err: any) {
          return new Response(
            JSON.stringify({ ok: false, error: err.message || "Failed to test connection." }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
