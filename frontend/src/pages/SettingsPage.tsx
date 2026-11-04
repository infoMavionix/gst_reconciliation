import { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import { SaveRounded, RefreshRounded } from "@mui/icons-material";
import api from "../api/client";
import { useAuth } from "../auth/AuthContext";

type Org={id:number;name:string;legal_name:string|null;gstin:string|null;pan:string|null;business_email:string|null};
export default function SettingsPage(){
 const {user}=useAuth(); const [form,setForm]=useState<Org>({id:0,name:"",legal_name:"",gstin:"",pan:"",business_email:""});
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 const canEdit=["OWNER","ADMIN"].includes((user?.memberships?.[0]?.role||"").toUpperCase());
 const load=async()=>{setLoading(true);setError("");try{const {data}=await api.get<Org>("/organizations/current");setForm({...data,legal_name:data.legal_name||"",gstin:data.gstin||"",pan:data.pan||"",business_email:data.business_email||""});}catch(e:any){setError(e.response?.data?.detail||"Unable to load organization settings.");}finally{setLoading(false);}};
 useEffect(()=>{void load();},[]);
 const change=(key:keyof Org)=>(e:React.ChangeEvent<HTMLInputElement>)=>setForm(p=>({...p,[key]:e.target.value}));
 const save=async()=>{setSaving(true);setError("");setSuccess("");try{const {data}=await api.patch<Org>("/organizations/current",{name:form.name,legal_name:form.legal_name||null,gstin:form.gstin||null,pan:form.pan||null,business_email:form.business_email||null});setForm({...data,legal_name:data.legal_name||"",gstin:data.gstin||"",pan:data.pan||"",business_email:data.business_email||""});setSuccess("Organization details updated successfully.");}catch(e:any){setError(e.response?.data?.detail||"Unable to save organization settings.");}finally{setSaving(false);}};
 return <Box><Typography className="eyebrow">WORKSPACE CONFIGURATION</Typography><Typography variant="h4" fontWeight={800} sx={{mb:.5}}>Settings</Typography><Typography color="text.secondary" fontSize={13} sx={{mb:2}}>Manage the organization identity and GST details used in your reconciliation workspace.</Typography>
 {error&&<Alert severity="error" sx={{mb:2}}>{error}</Alert>}{success&&<Alert severity="success" sx={{mb:2}}>{success}</Alert>}
 <Paper className="panel" elevation={0}>
  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{mb:2}}><Box><Typography fontWeight={800}>Organization profile</Typography><Typography color="text.secondary" fontSize={12}>These details belong to your active organization.</Typography></Box><Button startIcon={<RefreshRounded/>} onClick={()=>void load()} disabled={loading}>Reload</Button></Stack>
  {loading?<CircularProgress/>:<>
   <Box sx={{display:"grid",gridTemplateColumns:{xs:"1fr",md:"repeat(2,minmax(0,1fr))"},gap:2}}>
    <TextField label="Organization name" value={form.name} onChange={change("name")} required fullWidth/>
    <TextField label="Legal name" value={form.legal_name} onChange={change("legal_name")} fullWidth/>
    <TextField label="GSTIN" value={form.gstin} onChange={change("gstin")} inputProps={{maxLength:15}} fullWidth/>
    <TextField label="PAN" value={form.pan} onChange={change("pan")} inputProps={{maxLength:10}} fullWidth/>
    <TextField label="Business email" value={form.business_email} onChange={change("business_email")} type="email" fullWidth/>
   </Box>
   <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{mt:3}}>
    <Typography color="text.secondary" fontSize={11}>{canEdit?"Owner/admin access":"Read-only: ask an organization owner or admin to update these details."}</Typography>
    <Button variant="contained" startIcon={saving?<CircularProgress size={16} color="inherit"/>:<SaveRounded/>} disabled={!canEdit||saving||!form.name.trim()} onClick={()=>void save()}>Save changes</Button>
   </Stack>
  </>}
 </Paper>
 <Paper className="panel" elevation={0} sx={{mt:2}}><Typography fontWeight={800}>Account & access</Typography><Typography color="text.secondary" fontSize={13} sx={{mt:1}}>Signed in as {user?.full_name} ({user?.email}). Your current role is {user?.memberships?.[0]?.role||"Member"}. Team management and security controls are not yet exposed by the current backend.</Typography></Paper>
 </Box>;
}
