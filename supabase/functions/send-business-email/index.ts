import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

Deno.serve(async(req)=>{
  if(req.method!=='POST')return new Response('Method not allowed',{status:405})
  if(req.headers.get('x-webhook-secret')!==Deno.env.get('WEBHOOK_SECRET'))return new Response('Unauthorized',{status:401})
  const {to,subject,html}=await req.json()
  if(!Array.isArray(to)||!subject||!html)return new Response('Invalid payload',{status:400})
  const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'Content-Type':'application/json','api-key':Deno.env.get('BREVO_API_KEY')??''},body:JSON.stringify({sender:{name:'Hệ thống Lạc Hồng',email:Deno.env.get('MAIL_FROM')},to:to.map((email:string)=>({email})),subject,htmlContent:html})})
  return new Response(JSON.stringify({ok:response.ok,status:response.status}),{status:response.ok?200:502,headers:{'Content-Type':'application/json'}})
})
