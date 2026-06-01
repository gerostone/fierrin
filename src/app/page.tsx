import Link from 'next/link';

export default function Home() {
  return (
    <div className="text-center py-20">
      <h1 className="text-3xl font-bold text-[#1a3a5c]">Encontrá tu próximo auto</h1>
      <p className="mt-2 text-gray-600">Buscá en varios portales desde un solo lugar.</p>
      <Link href="/buscar" className="mt-6 inline-block rounded bg-[#1a3a5c] px-5 py-2 text-white">
        Buscar autos
      </Link>
    </div>
  );
}
