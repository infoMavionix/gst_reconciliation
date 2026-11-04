import { Box, Paper, Typography } from "@mui/material";
export default function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return <Box><Typography className="eyebrow">WORKSPACE</Typography><Typography variant="h4" fontWeight={800} sx={{ mt: .5, mb: 2 }}>{title}</Typography><Paper className="panel" elevation={0}><Typography fontWeight={700}>Coming in the next phase</Typography><Typography color="text.secondary" fontSize={13} sx={{ mt: 1 }}>{description}</Typography></Paper></Box>;
}
