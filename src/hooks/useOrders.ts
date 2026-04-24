import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Order {
  id: string;
  orderNumber: string;
  separator: string;
  collaborators: string[];
  startTime: Date;
  endTime: Date | null;
  status: 'na_fila' | 'separando' | 'finalizado';
  date: string;
  porFora: boolean;
}

export const useOrders = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [dailyTotal, setDailyTotal] = useState(0);
  const [dailyOrdersCount, setDailyOrdersCount] = useState(0);
  const [dailyOrdersOutside, setDailyOrdersOutside] = useState(0);
  const [romaneioStartTime, setRomaneioStartTime] = useState<string | null>(null);
  const [romaneioEndTime, setRomaneioEndTime] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    today.setHours(today.getHours() - 3);
    return today.toISOString().split('T')[0];
  });
  const [separators, setSeparators] = useState<string[]>([]);
  const { isAuthenticated } = useAuth();

  // Carregar separadores do banco
  useEffect(() => {
    const loadSeparators = async () => {
      const { data } = await supabase
        .from('separadores')
        .select('nome')
        .order('nome');
      
      if (data) {
        setSeparators(data.map(s => s.nome));
      }
    };

    loadSeparators();

    // Realtime para separadores
    const channel = supabase
      .channel('separadores-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'separadores'
        },
        () => {
          setTimeout(() => {
            loadSeparators();
          }, 0);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Carregar pedidos do banco
  useEffect(() => {
    const loadOrders = async () => {
      const { data: pedidosData } = await supabase
        .from('pedidos')
        .select('*')
        .eq('data', selectedDate)
        .order('created_at', { ascending: true });

      if (pedidosData) {
        const ordersWithCollaborators = await Promise.all(
          pedidosData.map(async (pedido) => {
            const { data: colabData } = await supabase
              .from('colaboradores_pedido')
              .select('nome_colaborador')
              .eq('pedido_id', pedido.id);

            return {
              id: pedido.id,
              orderNumber: pedido.numero_pedido,
              separator: pedido.separador,
              collaborators: colabData?.map(c => c.nome_colaborador) || [],
              startTime: new Date(pedido.hora_inicio),
              endTime: pedido.hora_fim ? new Date(pedido.hora_fim) : null,
              status: pedido.status as 'na_fila' | 'separando' | 'finalizado',
              date: pedido.data,
              porFora: (pedido as { por_fora?: boolean }).por_fora || false,
            };
          })
        );

        setOrders(ordersWithCollaborators);
      }
    };

    loadOrders();

    // Realtime para pedidos
    const channel = supabase
      .channel('pedidos-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pedidos',
          filter: `data=eq.${selectedDate}`
        },
        () => {
          setTimeout(() => {
            loadOrders();
          }, 0);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'colaboradores_pedido'
        },
        () => {
          setTimeout(() => {
            loadOrders();
          }, 0);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDate]);

  // Carregar configuração do dia
  useEffect(() => {
    const loadConfig = async () => {
      const { data } = await supabase
        .from('configuracao')
        .select('*')
        .eq('data', selectedDate)
        .maybeSingle();

      if (data) {
        setDailyTotal(data.total_folhas_dia);
        setDailyOrdersCount((data as { total_pedidos_dia?: number }).total_pedidos_dia || 0);
        setDailyOrdersOutside((data as { total_pedidos_fora?: number }).total_pedidos_fora || 0);
        setRomaneioStartTime((data as { hora_inicio_romaneio?: string }).hora_inicio_romaneio || null);
        setRomaneioEndTime((data as { hora_fim_romaneio?: string }).hora_fim_romaneio || null);
      } else {
        setDailyTotal(0);
        setDailyOrdersCount(0);
        setDailyOrdersOutside(0);
        setRomaneioStartTime(null);
        setRomaneioEndTime(null);
      }
    };

    loadConfig();
  }, [selectedDate]);

  const addOrder = async (
    orderNumber: string,
    separator: string,
    porFora: boolean = false
  ): Promise<{ success: boolean; error?: string }> => {
    if (!isAuthenticated) return { success: false, error: 'Não autenticado' };

    const existing = orders.find(o => o.orderNumber === orderNumber);
    if (existing) return { success: false, error: 'Esta folha já foi adicionada' };

    if (!porFora) {
      // Só validar conflito de separador para folhas normais
      const separatorInProgress = orders.find(o => o.separator === separator && o.status === 'separando' && !o.porFora);
      if (separatorInProgress) {
        return { success: false, error: `${separator} já está separando a folha ${separatorInProgress.orderNumber}` };
      }
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('pedidos')
      .insert({
        numero_pedido: orderNumber,
        separador: separator,
        status: porFora ? 'finalizado' : 'separando',
        data: selectedDate,
        por_fora: porFora,
        hora_fim: porFora ? now : null,
      } as { numero_pedido: string; separador: string; status: string; data: string; por_fora: boolean; hora_fim: string | null });

    return error ? { success: false, error: 'Erro ao adicionar folha' } : { success: true };
  };

  const finishOrder = async (orderId: string): Promise<boolean> => {
    if (!isAuthenticated) return false;

    const { error } = await supabase
      .from('pedidos')
      .update({
        hora_fim: new Date().toISOString(),
        status: 'finalizado',
      })
      .eq('id', orderId);

    return !error;
  };

  const removeOrder = async (orderId: string): Promise<void> => {
    if (!isAuthenticated) return;

    await supabase
      .from('pedidos')
      .delete()
      .eq('id', orderId);
  };

  const clearAllOrders = async (): Promise<void> => {
    if (!isAuthenticated) return;

    await supabase
      .from('pedidos')
      .delete()
      .eq('data', selectedDate);
  };

  const getStats = () => {
    const todayOrders = orders;
    const total = todayOrders.length;
    const inProgress = todayOrders.filter(o => o.status === 'separando').length;
    const completed = todayOrders.filter(o => o.status === 'finalizado').length;
    const progressPercentage = dailyTotal > 0 ? Math.round((completed / dailyTotal) * 100) : 0;
    
    const finishedOrders = todayOrders.filter(o => o.status === 'finalizado' && !o.porFora);
    let avgTime = 0;
    
    if (finishedOrders.length > 0) {
      const totalTime = finishedOrders.reduce((sum, order) => {
        return sum + (order.endTime!.getTime() - order.startTime.getTime());
      }, 0);
      avgTime = Math.round(totalTime / finishedOrders.length / (1000 * 60));
    }

    return { total, inProgress, completed, avgTime, progressPercentage, dailyTotal };
  };

  const getSeparatorStats = () => {
    const finishedOrders = orders.filter(o => o.status === 'finalizado');
    const statsMap = new Map<string, number>();
    
    finishedOrders.forEach(order => {
      const current = statsMap.get(order.separator) || 0;
      statsMap.set(order.separator, current + 1);
    });
    
    return Array.from(statsMap.entries()).map(([name, completed]) => ({
      name,
      completed,
    }));
  };

  const getUniqueSeparatorsCount = () => {
    const activeSeparators = new Set<string>();
    orders.forEach(order => {
      activeSeparators.add(order.separator);
      order.collaborators.forEach(c => activeSeparators.add(c));
    });
    return activeSeparators.size;
  };

  const getBusySeparators = () => {
    return orders
      .filter(o => o.status === 'separando')
      .map(o => ({ name: o.separator, orderNumber: o.orderNumber }));
  };

  const exportToCsv = (): string => {
    const totalPedidos = dailyOrdersCount + dailyOrdersOutside;
    // Cabeçalho com informações do dia
    const summaryHeaders = ['Resumo do Dia'];
    const summaryRows = [
      ['Data', selectedDate],
      ['Total de Folhas do Dia', dailyTotal.toString()],
      ['Pedidos do Dia', dailyOrdersCount.toString()],
      ['Pedidos por Fora', dailyOrdersOutside.toString()],
      ['Total de Pedidos', totalPedidos.toString()],
      ['Início do Romaneio', romaneioStartTime || 'Não definido'],
      ['Fim do Romaneio', romaneioEndTime || 'Não definido'],
      [''],
    ];

    const headers = ['Data', 'Número da Folha', 'Separador Principal', 'Colaboradores', 'Hora Início', 'Hora Fim', 'Tempo Separação', 'Status', 'Origem'];
    
    const rows = orders.map(order => [
      order.date,
      order.orderNumber,
      order.separator,
      order.collaborators.join('; '),
      order.startTime.toLocaleTimeString('pt-BR'),
      order.endTime ? order.endTime.toLocaleTimeString('pt-BR') : '',
      order.endTime 
        ? `${Math.floor((order.endTime.getTime() - order.startTime.getTime()) / (1000 * 60))}m ${Math.floor(((order.endTime.getTime() - order.startTime.getTime()) % (1000 * 60)) / 1000)}s`
        : '',
      order.status === 'separando' ? 'Em Separação' : 'Finalizado',
      order.porFora ? 'Por Fora' : 'Romaneio'
    ]);

    const summarySection = [summaryHeaders, ...summaryRows].map(row => row.join(',')).join('\n');
    const ordersSection = [headers, ...rows].map(row => row.join(',')).join('\n');

    return `${summarySection}\n${ordersSection}`;
  };

  const addSeparator = async (name: string): Promise<boolean> => {
    if (!isAuthenticated) return false;
    if (separators.includes(name.trim())) return false;

    const { error } = await supabase
      .from('separadores')
      .insert({ nome: name.trim() });

    return !error;
  };

  const removeSeparator = async (name: string): Promise<void> => {
    if (!isAuthenticated) return;

    await supabase
      .from('separadores')
      .delete()
      .eq('nome', name);
  };

  const updateOrderSeparator = async (orderId: string, newSeparator: string): Promise<boolean> => {
    if (!isAuthenticated) return false;

    const { error } = await supabase
      .from('pedidos')
      .update({ separador: newSeparator })
      .eq('id', orderId)
      .eq('status', 'separando');

    return !error;
  };

  const addCollaborators = async (orderId: string, collaboratorNames: string[]): Promise<boolean> => {
    if (!isAuthenticated) return false;

    const order = orders.find(o => o.id === orderId);
    if (!order || order.status !== 'separando') return false;

    const newCollaborators = collaboratorNames.filter(name => 
      !order.collaborators.includes(name) && name !== order.separator
    );
    
    if (newCollaborators.length === 0) return false;

    const { error } = await supabase
      .from('colaboradores_pedido')
      .insert(
        newCollaborators.map(name => ({
          pedido_id: orderId,
          nome_colaborador: name,
        }))
      );

    return !error;
  };

  const removeCollaborator = async (orderId: string, collaboratorName: string): Promise<boolean> => {
    if (!isAuthenticated) return false;

    const { error } = await supabase
      .from('colaboradores_pedido')
      .delete()
      .eq('pedido_id', orderId)
      .eq('nome_colaborador', collaboratorName);

    return !error;
  };

  const updateDailyTotal = async (total: number): Promise<void> => {
    if (!isAuthenticated) return;

    const { data: existing } = await supabase
      .from('configuracao')
      .select('id')
      .eq('data', selectedDate)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('configuracao')
        .update({ total_folhas_dia: total })
        .eq('data', selectedDate);
    } else {
      await supabase
        .from('configuracao')
        .insert({
          data: selectedDate,
          total_folhas_dia: total,
        });
    }
    
    setDailyTotal(total);
  };

  const updateDailyOrdersCount = async (count: number): Promise<void> => {
    if (!isAuthenticated) return;

    const { data: existing } = await supabase
      .from('configuracao')
      .select('id')
      .eq('data', selectedDate)
      .maybeSingle();

    if (existing) {
      await (supabase
        .from('configuracao')
        .update({ total_pedidos_dia: count } as { total_pedidos_dia: number })
        .eq('data', selectedDate));
    } else {
      await (supabase
        .from('configuracao')
        .insert({
          data: selectedDate,
          total_pedidos_dia: count,
        } as { data: string; total_pedidos_dia: number }));
    }
    
    setDailyOrdersCount(count);
  };

  const updateDailyOrdersOutside = async (count: number): Promise<void> => {
    if (!isAuthenticated) return;

    const { data: existing } = await supabase
      .from('configuracao')
      .select('id')
      .eq('data', selectedDate)
      .maybeSingle();

    if (existing) {
      await (supabase
        .from('configuracao')
        .update({ total_pedidos_fora: count } as { total_pedidos_fora: number })
        .eq('data', selectedDate));
    } else {
      await (supabase
        .from('configuracao')
        .insert({
          data: selectedDate,
          total_pedidos_fora: count,
        } as { data: string; total_pedidos_fora: number }));
    }

    setDailyOrdersOutside(count);
  };

  const getTodayOrders = () => {
    return orders;
  };

  const updateRomaneioStartTime = async (time: string | null): Promise<void> => {
    if (!isAuthenticated) return;

    const { data: existing } = await supabase
      .from('configuracao')
      .select('id')
      .eq('data', selectedDate)
      .maybeSingle();

    if (existing) {
      await (supabase
        .from('configuracao')
        .update({ hora_inicio_romaneio: time } as { hora_inicio_romaneio: string | null })
        .eq('data', selectedDate));
    } else {
      await (supabase
        .from('configuracao')
        .insert({
          data: selectedDate,
          hora_inicio_romaneio: time,
        } as { data: string; hora_inicio_romaneio: string | null }));
    }
    
    setRomaneioStartTime(time);
  };

  const updateRomaneioEndTime = async (time: string | null): Promise<void> => {
    if (!isAuthenticated) return;

    const { data: existing } = await supabase
      .from('configuracao')
      .select('id')
      .eq('data', selectedDate)
      .maybeSingle();

    if (existing) {
      await (supabase
        .from('configuracao')
        .update({ hora_fim_romaneio: time } as { hora_fim_romaneio: string | null })
        .eq('data', selectedDate));
    } else {
      await (supabase
        .from('configuracao')
        .insert({
          data: selectedDate,
          hora_fim_romaneio: time,
        } as { data: string; hora_fim_romaneio: string | null }));
    }
    
    setRomaneioEndTime(time);
  };

  return {
    orders: getTodayOrders(),
    allOrders: orders,
    addOrder,
    finishOrder,
    removeOrder,
    clearAllOrders,
    getStats,
    getSeparatorStats,
    getUniqueSeparatorsCount,
    getBusySeparators,
    exportToCsv,
    dailyTotal,
    setDailyTotal: updateDailyTotal,
    dailyOrdersCount,
    setDailyOrdersCount: updateDailyOrdersCount,
    dailyOrdersOutside,
    setDailyOrdersOutside: updateDailyOrdersOutside,
    romaneioStartTime,
    setRomaneioStartTime: updateRomaneioStartTime,
    romaneioEndTime,
    setRomaneioEndTime: updateRomaneioEndTime,
    selectedDate,
    setSelectedDate,
    separators,
    addSeparator,
    removeSeparator,
    updateOrderSeparator,
    addCollaborators,
    removeCollaborator,
  };
};
