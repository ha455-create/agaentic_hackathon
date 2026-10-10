import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // 1. Handle CORS Preflight Options Request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Initialize Supabase Client with the caller's Auth Token
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // 3. Get the Logged-In User's Identity securely from the token
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized access')

    // 4. Read the incoming payload from the user interface
    const { message } = await req.json()

    // 5. Initialize an Admin Client to fetch user history across RLS locks
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 6. Fetch the last 5 chat logs for this specific user
    const { data: history, error: historyError } = await supabaseAdmin
      .from('ai_charts')
      .select('user_input, ai_output')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)

    if (historyError) throw historyError

    // 7. Format the history into a structural prompt for Gemini
    let conversationHistoryString = ""
    if (history && history.length > 0) {
      conversationHistoryString = history.reverse().map(
        row => `User: ${row.user_input}\nModel: ${row.ai_output}`
      ).join("\n")
    }

    const systemInstruction = "You are a helpful assistant. You are provided with the user's recent conversation history below to provide personalized context."

    // 8. Execute the call out to Google AI Studio Gemini API
    const AI_STUDIO_KEY = Deno.env.get('GEMINI_API_KEY')
    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${AI_STUDIO_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemInstruction}\n\nHistory Context:\n${conversationHistoryString}\n\nCurrent User Query: ${message}` }] }]
      })
    })

    const aiData = await aiResponse.json()
    
    if (!aiData.candidates || !aiData.candidates[0]?.content?.parts[0]?.text) {
      throw new Error(`Gemini API Error: ${JSON.stringify(aiData)}`)
    }
    
    const aiTextOutput = aiData.candidates[0].content.parts[0].text

    // REPLACE STEP 9 IN YOUR CODE WITH THIS UPDATE PIPELINE:
const { error: updateError } = await supabaseAdmin
  .from('ai_charts')
  .update({ ai_response: aiTextOutput }) // Updates the blank field
  .eq('id', messageId)                 // Target the exact row that triggered it

  

    // 10. Send the generated answer back to your Frontend
    return new Response(
      JSON.stringify({ response: aiTextOutput }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    )
  }
})
