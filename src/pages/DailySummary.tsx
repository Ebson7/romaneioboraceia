import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy,
  Timestamp
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ArrowLeft, FileText, Package, Trophy, Clock, Calendar } from 'lucide-react';
import { Link } from 'react-router-dom';

interface DaySummary {
  date: string;
  totalFolhas: number;
  totalPedidos: number;
  completedFolhas: number;
  romaneioStartTime: string | null;
  romaneioEndTime: string | null;
  topSeparators: { name: string; count: number }[];
}

const DailySummary = () => {
  const [summaries, setSummaries] = useState<DaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  useEffect(() => {
    loadSummaries();
  }, [startDate, endDate]);

  const loadSummaries = async () => {
    setLoading(true);

    try {
      // Buscar configurações do período
      const configQ = query(
        collection(db, 'configuracao'),
        where('data', '>=', startDate),
        where('data', '<=', endDate),
        orderBy('data', 'desc')
      );
      const configSnap = await getDocs(configQ);

      // Buscar pedidos do período
      const pedidosQ = query(
        collection(db, 'pedidos'),
        where('data', '>=', startDate),
        where('data', '<=', endDate)
      );
      const pedidosSnap = await getDocs(pedidosQ);

      // Agrupar dados por data
      const summaryMap = new Map<string, DaySummary>();

      // Inicializar com configurações
      configSnap.docs.forEach(docSnap => {
        const config = docSnap.data();
        summaryMap.set(docSnap.id, {
          date: docSnap.id,
          totalFolhas: config.total_folhas_dia || 0,
          totalPedidos: config.total_pedidos_dia || 0,
          completedFolhas: 0,
          romaneioStartTime: config.hora_inicio_romaneio || null,
          romaneioEndTime: config.hora_fim_romaneio || null,
          topSeparators: [],
        });
      });

      // Contar folhas finalizadas e separadores por data
      const separatorCountByDate = new Map<string, Map<string, number>>();

      pedidosSnap.docs.forEach(pedidoDoc => {
        const pedido = pedidoDoc.data();
        const date = pedido.data;
        
        if (!summaryMap.has(date)) {
          summaryMap.set(date, {
            date,
            totalFolhas: 0,
            totalPedidos: 0,
            completedFolhas: 0,
            romaneioStartTime: null,
            romaneioEndTime: null,
            topSeparators: [],
          });
        }

        const summary = summaryMap.get(date)!;

        if (pedido.status === 'finalizado') {
          summary.completedFolhas++;

          // Contar por separador
          if (!separatorCountByDate.has(date)) {
            separatorCountByDate.set(date, new Map());
          }
          const separatorCount = separatorCountByDate.get(date)!;
          separatorCount.set(pedido.separador, (separatorCount.get(pedido.separador) || 0) + 1);
        }
      });

    // Calcular top 5 separadores por data
    separatorCountByDate.forEach((separatorCount, date) => {
      const summary = summaryMap.get(date);
      if (summary) {
        summary.topSeparators = Array.from(separatorCount.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
      }
    });

    // Converter para array e ordenar por data
    const summariesArray = Array.from(summaryMap.values())
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    setSummaries(summariesArray);
    setLoading(false);
    } catch (error) {
      console.error("Error loading summaries:", error);
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('pt-BR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const calculateDuration = (start: string | null, end: string | null) => {
    if (!start || !end) return null;
    
    const [startHours, startMinutes] = start.split(':').map(Number);
    const [endHours, endMinutes] = end.split(':').map(Number);
    
    const startTotalMinutes = startHours * 60 + startMinutes;
    const endTotalMinutes = endHours * 60 + endMinutes;
    
    let diffMinutes = endTotalMinutes - startTotalMinutes;
    if (diffMinutes < 0) diffMinutes += 24 * 60;
    
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    
    return `${hours > 0 ? `${hours}h ` : ''}${minutes}min`;
  };

  return (
    <div className="min-h-screen bg-background transition-colors">
      <div className="container mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="outline" size="icon">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Resumo Diário
              </h1>
              <p className="text-muted-foreground">
                Histórico de separação por dia
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>

        {/* Filtros de Data */}
        <Card className="bg-gradient-card shadow-card border-border/50">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Data Inicial</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-48"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">Data Final</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-48"
                />
              </div>
              <Button onClick={loadSummaries} variant="secondary">
                Atualizar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Lista de Resumos */}
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            Carregando...
          </div>
        ) : summaries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            Nenhum dado encontrado para o período selecionado.
          </div>
        ) : (
          <div className="space-y-6">
            {summaries.map((summary) => (
              <Card key={summary.date} className="bg-gradient-card shadow-card border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-card-foreground">
                    <Calendar className="w-5 h-5 text-primary" />
                    {formatDate(summary.date)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Métricas principais */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <FileText className="w-8 h-8 text-blue-500" />
                      <div>
                        <p className="text-sm text-muted-foreground">Folhas do Dia</p>
                        <p className="text-2xl font-bold text-card-foreground">{summary.totalFolhas}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <Package className="w-8 h-8 text-green-500" />
                      <div>
                        <p className="text-sm text-muted-foreground">Pedidos do Dia</p>
                        <p className="text-2xl font-bold text-card-foreground">{summary.totalPedidos}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <FileText className="w-8 h-8 text-emerald-500" />
                      <div>
                        <p className="text-sm text-muted-foreground">Finalizadas</p>
                        <p className="text-2xl font-bold text-card-foreground">{summary.completedFolhas}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <Clock className="w-8 h-8 text-amber-500" />
                      <div>
                        <p className="text-sm text-muted-foreground">Duração</p>
                        <p className="text-xl font-bold text-card-foreground">
                          {calculateDuration(summary.romaneioStartTime, summary.romaneioEndTime) || '-'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Top 5 Separadores */}
                  {summary.topSeparators.length > 0 && (
                    <div className="p-4 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-2 mb-3">
                        <Trophy className="w-5 h-5 text-yellow-500" />
                        <h3 className="font-semibold text-card-foreground">Top 5 Separadores</h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {summary.topSeparators.map((sep, index) => (
                          <div
                            key={sep.name}
                            className={`flex items-center gap-2 px-3 py-2 rounded-full ${
                              index === 0
                                ? 'bg-yellow-500/20 border border-yellow-500/50'
                                : index === 1
                                ? 'bg-gray-400/20 border border-gray-400/50'
                                : index === 2
                                ? 'bg-amber-700/20 border border-amber-700/50'
                                : 'bg-secondary border border-border'
                            }`}
                          >
                            <span className={`text-sm font-medium ${
                              index === 0 ? 'text-yellow-500' :
                              index === 1 ? 'text-gray-400' :
                              index === 2 ? 'text-amber-600' :
                              'text-muted-foreground'
                            }`}>
                              #{index + 1}
                            </span>
                            <span className="text-card-foreground font-medium">{sep.name}</span>
                            <span className="text-primary font-bold">{sep.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Horários */}
                  {(summary.romaneioStartTime || summary.romaneioEndTime) && (
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      {summary.romaneioStartTime && (
                        <span>Início: <strong className="text-card-foreground">{summary.romaneioStartTime}</strong></span>
                      )}
                      {summary.romaneioEndTime && (
                        <span>Fim: <strong className="text-card-foreground">{summary.romaneioEndTime}</strong></span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DailySummary;
