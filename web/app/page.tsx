import Landing from "@/components/Landing";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

// Public home. Signed-in people get the same page with the button pointing at their board.
export default async function Home() {
  const viewer = await getViewer();
  return <Landing signedIn={!!viewer} />;
}
