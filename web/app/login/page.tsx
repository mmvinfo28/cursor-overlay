import LoginForm from "@/components/LoginForm";
import { auth0 } from "@/lib/auth0";

export const dynamic = "force-dynamic";

export default function Page() {
  return <LoginForm auth0={!!auth0} />;
}
