import Image from 'next/image';
import { PageTransition } from '@/components/animation/PageTransition';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-finca-peach/30 via-background to-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Image
            src="/Logo sin bg.png"
            alt="FincaOS"
            width={200}
            height={80}
            className="object-contain"
            priority
          />
        </div>
        {/* PageTransition anima el formulario en cada cambio de ruta auth */}
        <PageTransition duration={0.3}>
          {children}
        </PageTransition>
      </div>
    </div>
  );
}
