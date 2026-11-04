import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { RefreshRounded, SearchRounded, StorefrontRounded } from "@mui/icons-material";
import api from "../api/client";

type Vendor = { gstin:string; name:string; email:string|null; phone:string|null; invoice_count:number; taxable_value:string; tax_amount:string; last_invoice_date:string|null; name_is_gstin_fallback:boolean };
const money=(v:string)=>`₹${Number(v||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export default function VendorsPage(){
 const [items,setItems]=useState<Vendor[]>([]),[search,setSearch]=useState(""),[loading,setLoading]=useState(true),[error,setError]=useState(""),[total,setTotal]=useState(0);
 const load=useCallback(async()=>{setLoading(true);setError("");try{const {data}=await api.get("/vendors",{params:{search:search.trim()||undefined,limit:200,offset:0}});setItems(data.vendors||[]);setTotal(data.total||0);}catch(e:any){setError(e.response?.data?.detail||"Unable to load supplier data.");}finally{setLoading(false);}},[search]);
 useEffect(()=>{void load();},[load]);
 return <Box>
  <Typography className="eyebrow">PURCHASE REGISTER DIRECTORY</Typography>
  <Stack direction={{xs:"column",sm:"row"}} justifyContent="space-between" alignItems={{sm:"center"}} spacing={2} sx={{mb:2}}>
   <Box><Typography variant="h4" fontWeight={800}>Vendors</Typography><Typography color="text.secondary" fontSize={13}>Supplier directory built from your imported Books and GSTR-2B records.</Typography></Box>
   <Button variant="outlined" startIcon={<RefreshRounded/>} onClick={()=>void load()} disabled={loading}>Refresh</Button>
  </Stack>
  <Paper className="panel" elevation={0}>
   <Stack direction={{xs:"column",sm:"row"}} justifyContent="space-between" spacing={2} sx={{mb:2}}>
    <TextField size="small" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search vendor name or GSTIN" InputProps={{startAdornment:<SearchRounded fontSize="small" sx={{mr:1,color:"text.secondary"}}/>}} sx={{maxWidth:420,width:"100%"}}/>
    <Chip icon={<StorefrontRounded/>} label={`${total} suppliers`} variant="outlined"/>
   </Stack>
   {error&&<Alert severity="error" sx={{mb:2}}>{error}</Alert>}
   {loading?<Box sx={{py:5,textAlign:"center"}}><CircularProgress/></Box>:items.length===0?<Alert severity="info">No supplier records found. Import a Books purchase register or GSTR-2B workbook first.</Alert>:
   <TableContainer><Table size="small">
    <TableHead><TableRow>{["Supplier","GSTIN","Books records","Taxable value","Tax amount","Last invoice"].map(x=><TableCell key={x} sx={{fontWeight:800,whiteSpace:"nowrap"}}>{x}</TableCell>)}</TableRow></TableHead>
    <TableBody>{items.map(v=><TableRow key={v.gstin} hover>
     <TableCell><Typography fontWeight={700} fontSize={13}>{v.name}</Typography>{v.name_is_gstin_fallback&&<Typography color="text.secondary" fontSize={10}>Name not yet provided</Typography>}</TableCell>
     <TableCell sx={{fontFamily:"monospace",fontSize:12}}>{v.gstin}</TableCell>
     <TableCell>{v.invoice_count}</TableCell><TableCell sx={{whiteSpace:"nowrap"}}>{money(v.taxable_value)}</TableCell><TableCell sx={{whiteSpace:"nowrap"}}>{money(v.tax_amount)}</TableCell><TableCell>{v.last_invoice_date||"—"}</TableCell>
    </TableRow>)}</TableBody>
   </Table></TableContainer>}
   <Typography color="text.secondary" fontSize={11} sx={{mt:2}}>Vendor counts and totals are calculated from imported Books purchase-register records only, avoiding double-counting the same invoice from GSTR-2B. A supplier name is shown when a vendor master entry exists; otherwise GSTIN is used.</Typography>
  </Paper>
 </Box>;
}
