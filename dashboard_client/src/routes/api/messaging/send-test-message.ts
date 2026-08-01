import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/messaging/send-test-message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { provider, apiKey, apiSecret, senderId, whatsappEnabled, to, message, orgId } = body;

          let targetProvider = provider;
          let targetApiKey = apiKey;
          let targetApiSecret = apiSecret;
          let targetSenderId = senderId;
          let targetWhatsapp = whatsappEnabled;

          // 1. Fetch saved credentials from database using admin client if orgId is provided
          if (orgId) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: config, error: configErr } = await (supabaseAdmin as any)
              .from("messaging_config")
              .select("provider, api_key, api_secret, sender_id, whatsapp_enabled")
              .eq("org_id", orgId)
              .maybeSingle();

            if (configErr || !config) {
              return new Response(
                JSON.stringify({ ok: false, error: "Messaging configuration not found for this organization." }),
                { status: 404, headers: { "Content-Type": "application/json" } }
              );
            }
            targetProvider = config.provider;
            targetApiKey = config.api_key;
            targetApiSecret = config.api_secret;
            targetSenderId = config.sender_id;
            targetWhatsapp = config.whatsapp_enabled;
          }

          if (!targetProvider || !targetApiKey) {
            return new Response(
              JSON.stringify({ ok: false, error: "Missing messaging provider credentials." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          if (!to || !to.trim() || !message || !message.trim()) {
            return new Response(
              JSON.stringify({ ok: false, error: "Missing recipient number or message content." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          // 2. Perform mock delivery logging
          console.log(`[Messaging Gateway Mock]`);
          console.log(`- Provider: ${targetProvider}`);
          console.log(`- API Key: ${targetApiKey.substring(0, 4)}...`);
          console.log(`- Sender ID: ${targetSenderId || "Default"}`);
          console.log(`- Target Channel: ${targetWhatsapp ? "WhatsApp" : "SMS"}`);
          console.log(`- To: ${to}`);
          console.log(`- Message Body: "${message}"`);

          // Simulate API call delay
          await new Promise((resolve) => setTimeout(resolve, 600));

          return new Response(
            JSON.stringify({ ok: true, message: "Test message sent successfully (simulated)." }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        } catch (err: any) {
          return new Response(
            JSON.stringify({ ok: false, error: err.message || "Failed to send test message." }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
