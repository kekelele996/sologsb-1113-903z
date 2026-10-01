import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import ConflictBadge from '../components/common/ConflictBadge';
import FieldRow from '../components/common/FieldRow';
import { usePersistentStore } from '../hooks/usePersistentStore';
import { useConflictCheck } from '../hooks/useConflictCheck';
import { useMaintenanceCheck } from '../hooks/useMaintenanceCheck';
import { useSessionStore } from '../stores/sessionStore';
import { useNightStore } from '../stores/nightStore';
import { useTargetStore } from '../stores/targetStore';
import { useEquipmentStore } from '../stores/equipmentStore';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import { NIGHT_TOTAL_MINUTES, TARGET_COLOR, type AdjudicationDecision } from '../types';
import { axisMinutes, minutesToTime } from '../utils/astro';

const SLOT_MINUTES = 30;

/** 斜纹底色：维修窗口覆盖的时段（维护组登记的停机时段，只呈现、不抹排程） */
const HATCHED_SX = {
  backgroundImage:
    'repeating-linear-gradient(45deg, rgba(93,64,55,0.10) 0, rgba(93,64,55,0.10) 4px, transparent 4px, transparent 9px)',
};

/** 望远镜与终端分配视图：行 = 设备、列 = 30 分钟时段；设备冲突标红，维修窗口斜纹，牵制项待值班人裁定 */
export default function EquipmentPage() {
  usePersistentStore();
  const navigate = useNavigate();
  const telescopes = useEquipmentStore((s) => s.telescopes);
  const instruments = useEquipmentStore((s) => s.instruments);
  const fieldOfView = useEquipmentStore((s) => s.fieldOfView);
  const sessions = useSessionStore((s) => s.sessions);
  const rescheduleToBackup = useSessionStore((s) => s.rescheduleToBackup);
  const nights = useNightStore((s) => s.nights);
  const currentNightId = useNightStore((s) => s.currentNightId);
  const setCurrentNight = useNightStore((s) => s.setCurrentNight);
  const targets = useTargetStore((s) => s.targets);
  const { conflictsOfNight } = useConflictCheck();
  const maintenanceWindows = useMaintenanceStore((s) => s.windows);
  const noticeRead = useMaintenanceStore((s) => s.noticeRead);
  const reconciling = useMaintenanceStore((s) => s.reconciling);
  const reconcileError = useMaintenanceStore((s) => s.reconcileError);
  const lastReconcileAt = useMaintenanceStore((s) => s.lastReconcileAt);
  const reconcile = useMaintenanceStore((s) => s.reconcile);
  const retryReconcile = useMaintenanceStore((s) => s.retryReconcile);
  const addWindow = useMaintenanceStore((s) => s.addWindow);
  const removeWindow = useMaintenanceStore((s) => s.removeWindow);
  const adjudicate = useMaintenanceStore((s) => s.adjudicate);
  const { conflictsOfNight: maintenanceConflictsOfNight } = useMaintenanceCheck();

  const [nightId, setNightId] = useState(currentNightId);
  const activeNightId = nightId || currentNightId;
  const night = nights.find((item) => item.id === activeNightId);
  const nightSessions = useMemo(() => sessions.filter((session) => session.nightId === activeNightId), [sessions, activeNightId]);
  const conflicts = useMemo(() => conflictsOfNight(activeNightId), [conflictsOfNight, activeNightId]);
  const maintenanceConflicts = useMemo(
    () => maintenanceConflictsOfNight(activeNightId),
    [maintenanceConflictsOfNight, activeNightId],
  );
  const pendingConflicts = useMemo(() => maintenanceConflicts.filter((item) => !item.adjudicated), [maintenanceConflicts]);
  const slots = useMemo(() => Array.from({ length: NIGHT_TOTAL_MINUTES / SLOT_MINUTES }, (_, index) => index), []);

  const targetById = (id: string) => targets.find((target) => target.id === id);
  const telescopeById = (id: string) => telescopes.find((item) => item.id === id);
  const pairedInstrument = (telescopeCode: string) => instruments.find((instrument) => instrument.telescopeCode === telescopeCode);
  const backupNights = useMemo(() => nights.filter((item) => item.backup), [nights]);

  /** 本夜覆盖某望远镜的维修窗口（维护组登记，整夜停机） */
  const windowByTelescope = useMemo(() => {
    const map = new Map<string, (typeof maintenanceWindows)[number]>();
    if (!night) return map;
    maintenanceWindows
      .filter((window) => window.startDate <= night.date && night.date <= window.endDate)
      .forEach((window) => map.set(window.telescopeId, window));
    return map;
  }, [maintenanceWindows, night]);

  const maintenanceConflictSessionIds = useMemo(() => new Set(maintenanceConflicts.map((item) => item.sessionId)), [maintenanceConflicts]);

  /** 某望远镜在某时段内的排程段 */
  const occupancy = (telescopeId: string, slot: number) => {
    const slotStart = slot * SLOT_MINUTES;
    const slotEnd = slotStart + SLOT_MINUTES;
    return nightSessions
      .filter((session) => session.telescopeId === telescopeId)
      .filter((session) => {
        const start = axisMinutes(session.startTime);
        const rawEnd = axisMinutes(session.endTime);
        const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
        return Math.min(end, slotEnd) - Math.max(start, slotStart) > 0;
      })
      .sort((a, b) => axisMinutes(a.startTime) - axisMinutes(b.startTime));
  };

  /* ------------------------- 维修窗口登记对话框（维护组） ------------------------- */
  const [windowDialogOpen, setWindowDialogOpen] = useState(false);
  const [windowForm, setWindowForm] = useState({
    telescopeId: '',
    startDate: night?.date ?? '',
    endDate: night?.date ?? '',
    reason: '',
  });

  function openWindowDialog() {
    setWindowForm({
      telescopeId: telescopes.find((item) => item.status !== '可用')?.id ?? telescopes[0]?.id ?? '',
      startDate: night?.date ?? '',
      endDate: night?.date ?? '',
      reason: '',
    });
    setWindowDialogOpen(true);
  }

  async function submitWindow() {
    if (!windowForm.telescopeId || !windowForm.startDate || !windowForm.endDate) return;
    await addWindow({
      telescopeId: windowForm.telescopeId,
      startDate: windowForm.startDate,
      endDate: windowForm.endDate,
      reason: windowForm.reason || '设备维护',
      createdBy: '维护组',
    });
    setWindowDialogOpen(false);
  }

  /* ------------------------- 牵制项裁定对话框（值班人） ------------------------- */
  const [adjudicationOpen, setAdjudicationOpen] = useState(false);
  const [adjudicationTarget, setAdjudicationTarget] = useState<{ sessionId: string; windowId: string } | null>(null);
  const [decision, setDecision] = useState<AdjudicationDecision>('知悉保留');
  const [backupNightId, setBackupNightId] = useState('');
  const [adjudicationNote, setAdjudicationNote] = useState('');

  function openAdjudication(sessionId: string, windowId: string) {
    setAdjudicationTarget({ sessionId, windowId });
    setDecision('知悉保留');
    setBackupNightId('');
    setAdjudicationNote('');
    setAdjudicationOpen(true);
  }

  async function submitAdjudication() {
    if (!adjudicationTarget) return;
    const { sessionId, windowId } = adjudicationTarget;
    await adjudicate({ sessionId, windowId, decision, note: adjudicationNote, decidedBy: '值班人' });
    if (decision === '改期备用夜') {
      await rescheduleToBackup([sessionId], backupNightId, adjudicationNote || '排程段落在维修窗口内，值班人裁定改期至备用观测夜');
    }
    setAdjudicationOpen(false);
  }

  const adjudicatingSession = adjudicationTarget ? sessions.find((item) => item.id === adjudicationTarget.sessionId) : undefined;
  const adjudicatingWindow = adjudicationTarget ? maintenanceWindows.find((item) => item.id === adjudicationTarget.windowId) : undefined;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        望远镜与终端分配视图
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        以行 = 设备、列 = 30 分钟时段的占用网格呈现；同一望远镜在同一时段排入多段即标红，维修窗口覆盖时段加斜纹，排程段撞上维修窗口即交值班人裁定。
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }} alignItems="center">
        <TextField
          select
          size="small"
          label="观测夜"
          value={activeNightId}
          onChange={(event) => {
            setNightId(event.target.value);
            setCurrentNight(event.target.value);
          }}
          sx={{ minWidth: 240 }}
        >
          {nights.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {`${item.date} · ${item.siteName}${item.primary ? '（主夜）' : item.backup ? '（备用夜）' : ''}`}
            </MenuItem>
          ))}
        </TextField>
        <Chip size="small" label={night ? `月相 ${night.moonPhasePct}% · 云量 ${night.cloudText}` : '未选择观测夜'} />
        <ConflictBadge conflicts={conflicts} />
        {noticeRead ? (
          <Chip size="small" color="success" variant="outlined" label={`维护通告已读入${lastReconcileAt ? ` · 对账 ${new Date(lastReconcileAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}`} />
        ) : (
          <Chip size="small" color="warning" variant="outlined" label="维护通告未读入" />
        )}
      </Stack>

      {/* 维护通告 / 对账状态：没读进来时保留编排排程，对账失败只补维护侧 */}
      {reconcileError ? (
        <Alert severity="error" sx={{ mb: 2 }} action={
          <Button color="inherit" size="small" disabled={reconciling} onClick={() => void retryReconcile()}>
            重试（仅补维护侧）
          </Button>
        }>
          <AlertTitle>维护对账失败，编排排程未改动</AlertTitle>
          {reconcileError}
        </Alert>
      ) : !noticeRead ? (
        <Alert severity="info" sx={{ mb: 2 }} action={
          <Button color="inherit" size="small" disabled={reconciling} onClick={() => void reconcile()}>
            {reconciling ? '读入中…' : '读入维护通告并对账'}
          </Button>
        }>
          <AlertTitle>维护通告尚未读入，编排台保留当天已排程段</AlertTitle>
          维护组的维修窗口还没读进来，编排排程原样保留、不据此改动；读入通告后才会标出排程段与维修窗口的互相牵制。
        </Alert>
      ) : null}

      {conflicts.length > 0 ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          本夜存在 {conflicts.length} 处设备时段冲突，冲突格已在下方网格中标红：{' '}
          {conflicts.map((conflict) => `${conflict.sessionId}↔${conflict.otherId}（${conflict.overlapText}）`).join('；')}
        </Alert>
      ) : (
        <Alert severity="success" sx={{ mb: 2 }}>
          本夜各望远镜时段无重叠，无设备冲突
        </Alert>
      )}

      {/* 排程段 × 维修窗口牵制项：摆到设备分配视图上，等值班人裁定 */}
      {noticeRead && pendingConflicts.length > 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>排程段与维修窗口互相牵制（{pendingConflicts.length} 段待值班人裁定）</AlertTitle>
          {pendingConflicts.map((item) => {
            const session = sessions.find((s) => s.id === item.sessionId);
            return (
              <Box key={`${item.sessionId}-${item.windowId}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25, flexWrap: 'wrap' }}>
                <Typography variant="body2">
                  排程段 <strong>{item.sessionId}</strong>（{item.sessionTime} {targetById(session?.targetId ?? '')?.name ?? ''}）落在望远镜{' '}
                  <strong>{telescopeById(item.telescopeId)?.code ?? item.telescopeId}</strong> 的维修窗口内（{item.windowText}）
                </Typography>
                <Button size="small" variant="outlined" color="warning" onClick={() => openAdjudication(item.sessionId, item.windowId)}>
                  值班裁定
                </Button>
              </Box>
            );
          })}
        </Alert>
      ) : null}

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small" sx={{ minWidth: 1180 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 210 }}>望远镜 / 终端 / 视场角</TableCell>
              {slots.map((slot) => (
                <TableCell key={slot} align="center" sx={{ px: 0.25 }}>
                  {minutesToTime(slot * SLOT_MINUTES)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {telescopes.map((telescope) => {
              const instrument = pairedInstrument(telescope.code);
              const fov = instrument ? fieldOfView(telescope.id, instrument.id) : undefined;
              const underMaintenance = Boolean(windowByTelescope.get(telescope.id));
              return (
                <TableRow key={telescope.id}>
                  <TableCell>
                    <Stack spacing={0.25}>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {telescope.code}
                        </Typography>
                        <Chip
                          size="small"
                          label={telescope.status}
                          color={telescope.status === '可用' ? 'success' : telescope.status === '维护中' ? 'warning' : 'default'}
                          variant="outlined"
                        />
                        {underMaintenance ? <Chip size="small" color="warning" label="本夜维修" /> : null}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {telescope.apertureMm}mm · f/{telescope.focalLengthMm}mm · {telescope.mount} · 载荷 {telescope.maxPayloadKg}kg
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {instrument ? `${instrument.model}（${instrument.terminalType}）` : '未配终端'}
                        {fov ? ` · 视场 ${fov.text}` : ''}
                      </Typography>
                    </Stack>
                  </TableCell>
                  {slots.map((slot) => {
                    const items = occupancy(telescope.id, slot);
                    const isConflict = items.length > 1;
                    const target = items[0] ? targetById(items[0].targetId) : undefined;
                    const maintenanceItem = items.find((item) => maintenanceConflictSessionIds.has(item.id));
                    const cellSx = isConflict
                      ? { bgcolor: 'error.main', color: '#fff' }
                      : underMaintenance && items.length === 1
                        ? { bgcolor: 'warning.light', color: '#4a2c00', ...HATCHED_SX }
                        : underMaintenance
                          ? { ...HATCHED_SX, color: 'text.secondary' }
                          : items.length === 1
                            ? { bgcolor: TARGET_COLOR[target?.type ?? '星云'], color: '#fff' }
                            : { color: 'text.secondary' };
                    return (
                      <TableCell
                        key={slot}
                        align="center"
                        sx={{
                          px: 0.25,
                          py: 0.5,
                          ...cellSx,
                          cursor: items.length ? 'pointer' : 'default',
                          borderLeft: '1px solid',
                          borderColor: 'divider',
                        }}
                        onClick={() => {
                          if (isConflict) {
                            navigate(`/sessions?highlight=${items[0].id}&night=${activeNightId}`);
                          } else if (maintenanceItem) {
                            const conflict = maintenanceConflicts.find((c) => c.sessionId === maintenanceItem.id);
                            if (conflict) openAdjudication(conflict.sessionId, conflict.windowId);
                          } else if (items.length) {
                            navigate(`/sessions?highlight=${items[0].id}&night=${activeNightId}`);
                          }
                        }}
                      >
                        {items.length === 0 ? (
                          <Typography variant="caption">{underMaintenance ? '维' : '·'}</Typography>
                        ) : isConflict ? (
                          <Tooltip title={items.map((item) => `${item.startTime}-${item.endTime} ${targetById(item.targetId)?.name ?? ''}`).join(' ｜ ')}>
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              冲突 {items.length}
                            </Typography>
                          </Tooltip>
                        ) : maintenanceItem ? (
                          <Tooltip
                            title={`${maintenanceItem.startTime}-${maintenanceItem.endTime} ${target?.name ?? ''} · 落在维修窗口内，点击裁定`}
                          >
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              {target?.name ?? '已排'}·维
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Tooltip title={`${items[0].startTime}-${items[0].endTime} ${target?.name ?? ''} · ${items[0].status}`}>
                            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                              {target?.name ?? '已排'}
                            </Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* 维修窗口登记（维护组持有：只登记停机时段，不改排程段） */}
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1">维修窗口登记（维护组）</Typography>
        <Button size="small" variant="outlined" onClick={openWindowDialog}>
          登记维修窗口
        </Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>望远镜</TableCell>
              <TableCell>开始日期</TableCell>
              <TableCell>结束日期</TableCell>
              <TableCell>维护内容</TableCell>
              <TableCell>登记人</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {maintenanceWindows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="caption" color="text.secondary">
                    暂无维修窗口，望远镜停机时段由维护组在此登记
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              maintenanceWindows.map((window) => (
                <TableRow key={window.id} hover>
                  <TableCell>{telescopeById(window.telescopeId)?.code ?? window.telescopeId}</TableCell>
                  <TableCell>{window.startDate}</TableCell>
                  <TableCell>{window.endDate}</TableCell>
                  <TableCell>{window.reason}</TableCell>
                  <TableCell>{window.createdBy}</TableCell>
                  <TableCell align="right">
                    <Button size="small" color="error" onClick={() => void removeWindow(window.id)}>
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        终端清单与适配望远镜
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>型号</TableCell>
              <TableCell>类型</TableCell>
              <TableCell align="right">像元(μm)</TableCell>
              <TableCell>靶面(mm)</TableCell>
              <TableCell align="right">读出噪声(e-)</TableCell>
              <TableCell>适配望远镜</TableCell>
              <TableCell>视场角</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {instruments.map((instrument) => {
              const telescope = telescopes.find((item) => item.code === instrument.telescopeCode);
              const fov = telescope ? fieldOfView(telescope.id, instrument.id) : undefined;
              return (
                <TableRow key={instrument.id} hover>
                  <TableCell>{instrument.model}</TableCell>
                  <TableCell>{instrument.terminalType}</TableCell>
                  <TableCell align="right">{instrument.pixelSizeUm}</TableCell>
                  <TableCell>
                    {instrument.sensorWidthMm} × {instrument.sensorHeightMm}
                  </TableCell>
                  <TableCell align="right">{instrument.readNoiseE}</TableCell>
                  <TableCell>{telescope ? `${telescope.code}（${telescope.status}）` : '未适配'}</TableCell>
                  <TableCell>{fov?.text ?? '-'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ mt: 2 }}>
        <Button variant="outlined" onClick={() => navigate('/sessions')}>
          前往排程段列表处理冲突
        </Button>
      </Box>

      {/* 登记维修窗口对话框 */}
      <Dialog open={windowDialogOpen} onClose={() => setWindowDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>登记维修窗口（维护组）</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 1.5 }}>
            维修窗口由维护组登记望远镜的停机时段，登记后原样保留；编排台已排的排程段不会被抹掉，两边互相牵制处交值班人裁定。
          </Alert>
          <FieldRow label="望远镜" required>
            <TextField select size="small" fullWidth value={windowForm.telescopeId} onChange={(event) => setWindowForm({ ...windowForm, telescopeId: event.target.value })}>
              {telescopes.map((telescope) => (
                <MenuItem key={telescope.id} value={telescope.id}>
                  {`${telescope.code} · ${telescope.status}`}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="开始日期" required>
            <TextField size="small" type="date" fullWidth value={windowForm.startDate} onChange={(event) => setWindowForm({ ...windowForm, startDate: event.target.value })} InputLabelProps={{ shrink: true }} />
          </FieldRow>
          <FieldRow label="结束日期" required>
            <TextField size="small" type="date" fullWidth value={windowForm.endDate} onChange={(event) => setWindowForm({ ...windowForm, endDate: event.target.value })} InputLabelProps={{ shrink: true }} />
          </FieldRow>
          <FieldRow label="维护内容">
            <TextField size="small" fullWidth multiline minRows={2} value={windowForm.reason} onChange={(event) => setWindowForm({ ...windowForm, reason: event.target.value })} placeholder="例如：赤道仪定期检修" />
          </FieldRow>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWindowDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => void submitWindow()}>
            保存窗口
          </Button>
        </DialogActions>
      </Dialog>

      {/* 值班人裁定对话框 */}
      <Dialog open={adjudicationOpen} onClose={() => setAdjudicationOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>排程段 × 维修窗口 值班裁定</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            编排台已定排程段 <strong>{adjudicatingSession?.id}</strong>（{adjudicatingSession?.startTime}-{adjudicatingSession?.endTime}
            ，目标 {targetById(adjudicatingSession?.targetId ?? '')?.name}）落在维护组登记的维修窗口（{adjudicatingWindow?.startDate} 至 {adjudicatingWindow?.endDate}
            ，{adjudicatingWindow?.reason}）内。两边数据各自保留，请值班人裁定，系统不自动改任何一方。
          </Alert>
          <FieldRow label="裁定决定" required>
            <TextField select size="small" fullWidth value={decision} onChange={(event) => setDecision(event.target.value as AdjudicationDecision)}>
              {['知悉保留', '改期备用夜'].map((item) => (
                <MenuItem key={item} value={item}>
                  {item}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          {decision === '改期备用夜' ? (
            <FieldRow label="备用观测夜" required hint="裁定改期后该排程段置为「因云取消」并挂到替补夜">
              <TextField select size="small" fullWidth value={backupNightId} onChange={(event) => setBackupNightId(event.target.value)}>
                {backupNights.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {`${item.date} · ${item.cloudText} · 月相 ${item.moonPhasePct}%`}
                  </MenuItem>
                ))}
              </TextField>
            </FieldRow>
          ) : null}
          <FieldRow label="裁定备注">
            <TextField size="small" fullWidth multiline minRows={2} value={adjudicationNote} onChange={(event) => setAdjudicationNote(event.target.value)} placeholder="例如：该段目标可在维护后补拍，知悉保留" />
          </FieldRow>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdjudicationOpen(false)}>取消</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={decision === '改期备用夜' && !backupNightId}
            onClick={() => void submitAdjudication()}
          >
            确认裁定
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
