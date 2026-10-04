import { Hero3D } from "#components/hero";
import { Timeline } from "#components/timeline";
import { SmoothScrollProvider } from "#components/timeline/lenis-provider";

export default function HomePage() {
  return (
    <SmoothScrollProvider>
      <Hero3D />
      <Timeline />
    </SmoothScrollProvider>
  );
}
