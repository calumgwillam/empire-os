import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import EmpireDashboardClient from "./empire-dashboard-client";
import { isAuthorizedFounder } from "./lib/founder-access";

export default async function HomePage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const founderId = process.env.EMPIRE_OS_FOUNDER_CLERK_USER_ID;

  if (!isAuthorizedFounder(userId, founderId)) {
    notFound();
  }

  return <EmpireDashboardClient />;
}
