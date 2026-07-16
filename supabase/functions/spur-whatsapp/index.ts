import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SPUR_API_URL = Deno.env.get("SPUR_API_URL") || "https://api.spurnow.com";
const SPUR_API_KEY = Deno.env.get("SPUR_API_KEY");
const SPUR_FROM_NUMBER = "919667706043";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Country code mapping
const countryCodes: Record<string, string> = {
  "India": "91",
  "United States": "1",
  "Canada": "1",
  "United Kingdom": "44",
  "Australia": "61",
  "Germany": "49",
  "France": "33",
  "Japan": "81",
  "China": "86",
  "Brazil": "55",
  "UAE": "971",
  "Singapore": "65",
  "Hong Kong": "852",
};

// Format phone number with country code
const formatPhoneForWhatsApp = (phone: string, country: string): string => {
  if (!phone) return "";

  let formattedPhone = phone.replace(/\D/g, "");

  if (formattedPhone.startsWith("0")) {
    formattedPhone = formattedPhone.slice(1);
  }

  const countryCode = countryCodes[country] || "91";

  if (formattedPhone.startsWith(countryCode)) {
    return formattedPhone;
  }

  if (formattedPhone.length > 10) {
    return formattedPhone;
  }

  return countryCode + formattedPhone;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      customerName,
      customerPhone,
      customerCountry = "India",
      pdfUrl,
      template = "store_orderplaced_dev",
    } = body;

    // Validate required fields
    if (!customerName || !customerPhone) {
      console.error("Missing fields:", { customerName, customerPhone });
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: customerName, customerPhone",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!SPUR_API_KEY) {
      console.error("SPUR_API_KEY not configured");
      return new Response(
        JSON.stringify({ success: false, error: "SPUR_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formattedPhone = formatPhoneForWhatsApp(customerPhone, customerCountry);

    console.log(`Sending WhatsApp to: ${formattedPhone} (${customerName}) | Template: ${template}`);

    // Build template components
    const components: any[] = [
      {
        type: "body",
        parameters: [
          {
            type: "text",
            text: customerName,
          },
        ],
      },
    ];

    // Add PDF button only if pdfUrl is provided
    if (pdfUrl) {
      components.push({
        type: "button",
        index: 0,
        sub_type: "url",
        parameters: [
          {
            type: "text",
            text: pdfUrl,
          },
        ],
      });
    }

    const payload = {
      channel: "whatsapp",
      to: formattedPhone,
      content: {
        type: "template",
        template: {
          name: template,
          components,
          language: {
            code: "en",
          },
        },
      },
      options: {
        from: SPUR_FROM_NUMBER,
      },
    };

    console.log("Spur payload:", JSON.stringify(payload, null, 2));

    const response = await fetch(`${SPUR_API_URL}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SPUR_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Spur API error:", result);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to send WhatsApp",
          details: result,
        }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ WhatsApp sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
