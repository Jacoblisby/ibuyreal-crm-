/**
 * Forsiden sender direkte videre til on-market — det er dér arbejdet foregår.
 * Det gamle dashboard er taget ud af navigationen (august 2026); koden ligger
 * stadig i git-historikken hvis den skal genbruges.
 */
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/on-market');
}
