import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, BarChart3, Package, Truck, CheckCircle } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ViewModeIndicator } from '@/components/ViewModeIndicator';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useCargas } from '@/hooks/useCargas';
import { CargaForm } from '@/components/CargaForm';
import { CargaCard } from '@/components/CargaCard';
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy 
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

const Pedidos = () => {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [selectedDate] = useState(() => {
    const today = new Date();
    today.setHours(today.getHours() - 3);
    return today.toISOString().split('T')[0];
  });

  const [separators, setSeparators] = useState<string[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'separadores'), orderBy('nome'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sepList = snapshot.docs.map(docSnap => docSnap.data().nome as string);
      setSeparators(sepList);
    });

    return () => unsubscribe();
  }, []);

  const {
    cargas,
    addCarga,
    removeCarga,
    finishCarga,
    reopenCarga,
    addPedido,
    updatePedidoSeparador,
    removePedido,
  } = useCargas(selectedDate);

  const wrapAuth = <T extends (...args: any[]) => any>(fn: T): T =>
    ((...args: any[]) => {
      if (!isAuthenticated) {
        toast({ title: 'Acesso negado', description: 'Faça login para continuar', variant: 'destructive' });
        return Promise.resolve(false as any);
      }
      return fn(...args);
    }) as T;

  const handleAddCarga = async (motorista: string, qtd: number) => {
    if (!isAuthenticated) {
      toast({ title: 'Acesso negado', description: 'Faça login para continuar', variant: 'destructive' });
      return { success: false };
    }
    const result = await addCarga(motorista, qtd);
    if (result.success) {
      toast({ title: 'Carga criada', description: `Carga do ${motorista} com ${qtd} pedidos` });
    } else {
      toast({ title: 'Erro', description: result.error, variant: 'destructive' });
    }
    return result;
  };

  const handleAddPedido = async (cargaId: string, separador: string) => {
    if (!isAuthenticated) {
      toast({ title: 'Acesso negado', description: 'Faça login para continuar', variant: 'destructive' });
      return { success: false };
    }
    const result = await addPedido(cargaId, separador);
    if (result.success) {
      toast({ title: 'Pedido registrado', description: `Atribuído a ${separador}` });
    } else {
      toast({ title: 'Erro', description: result.error, variant: 'destructive' });
    }
    return result;
  };

  // Métricas agregadas (separadas das folhas)
  const totalCargas = cargas.length;
  const cargasAbertas = cargas.filter((c) => c.status === 'aberta').length;
  const totalPedidosRegistrados = cargas.reduce((sum, c) => sum + c.pedidos.length, 0);
  const totalPedidosPrevistos = cargas.reduce((sum, c) => sum + c.quantidadePedidos, 0);

  return (
    <div className="min-h-screen bg-background transition-colors">
      <div className="container mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="text-center py-8">
          <div className="flex justify-end items-center gap-3 mb-4">
            <ThemeToggle />
            <ViewModeIndicator />
          </div>

          {/* Botões grandes de navegação */}
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            <Link to="/">
              <Button size="lg" variant="outline" className="text-base px-8 py-6">
                <FileText className="w-5 h-5 mr-2" />
                Folhas
              </Button>
            </Link>
            <Button size="lg" className="text-base px-8 py-6 bg-gradient-primary shadow-glow">
              <Package className="w-5 h-5 mr-2" />
              Pedidos
            </Button>
            <Link to="/resumo">
              <Button size="lg" variant="outline" className="text-base px-8 py-6">
                <BarChart3 className="w-5 h-5 mr-2" />
                Resumo Diário
              </Button>
            </Link>
          </div>

          <h1 className="text-5xl font-bold text-foreground mb-3">Pedidos por Carga</h1>
          <p className="text-lg text-muted-foreground">
            Registre os pedidos separados por carga e motorista
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            {new Date().toLocaleDateString('pt-BR', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-card shadow-card border-border/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total de Cargas</p>
                  <p className="text-3xl font-bold text-foreground">{totalCargas}</p>
                </div>
                <Truck className="w-8 h-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-card shadow-card border-border/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Cargas Abertas</p>
                  <p className="text-3xl font-bold text-foreground">{cargasAbertas}</p>
                </div>
                <Package className="w-8 h-8 text-warning" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-card shadow-card border-border/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pedidos Registrados</p>
                  <p className="text-3xl font-bold text-foreground">{totalPedidosRegistrados}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-success" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-card shadow-card border-border/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Previsto</p>
                  <p className="text-3xl font-bold text-foreground">{totalPedidosPrevistos}</p>
                </div>
                <FileText className="w-8 h-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Form nova carga */}
        <CargaForm onAddCarga={handleAddCarga} isAuthenticated={isAuthenticated} />

        {/* Lista de cargas */}
        {cargas.length === 0 ? (
          <Card className="bg-gradient-card shadow-card border-border/50">
            <CardContent className="py-16 text-center">
              <Truck className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-lg text-muted-foreground">Nenhuma carga registrada hoje</p>
              <p className="text-sm text-muted-foreground mt-1">
                Crie uma nova carga para começar a registrar pedidos
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {cargas.map((carga) => (
              <CargaCard
                key={carga.id}
                carga={carga}
                separators={separators}
                isAuthenticated={isAuthenticated}
                onAddPedido={handleAddPedido}
                onUpdatePedidoSeparador={wrapAuth(updatePedidoSeparador)}
                onRemovePedido={wrapAuth(removePedido)}
                onRemoveCarga={wrapAuth(removeCarga)}
                onFinishCarga={wrapAuth(finishCarga)}
                onReopenCarga={wrapAuth(reopenCarga)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Pedidos;
