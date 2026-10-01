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
import Divider from '@mui/material/Divider';
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
import { useMaintenanceConflicts, type MaintenanceConflict } from '../hooks/useMaintenanceConflicts';
import { useSessionStore } from '../stores/sessionStore';
import { useNightStore } from '../stores/nightStore';
import { useTargetStore } from '../stores/targetStore';
import { useEquipmentStore } from '../stores/equipmentStore';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import { NIGHT_TOTAL_MINUTES, RULING_VERDICTS, TARGET_COLOR, type RulingVerdict } from '../types';
import { axisMinutes, durationMinutes, minutesToTime } from '../utils/astro';

const SLOT_MINUTES = 30;

interface RegisterFormState {
  telescopeId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  registeredBy: string;
}

interface RulingFormState {
  conflictKey: string;
  verdict: RulingVerdict;
  dutyOfficer: string;
  note: string;
}

/** 望远镜与终端分配视图：行 = 设备、列 = 30 分钟时段；排程互撞标红，维修窗口叠加斜纹，互相牵制处等值班人裁定 */
export default function EquipmentPage() {
  usePersistentStore();
  const navigate = useNavigate();
  const telescopes = useEquipmentStore((s) => s.telescopes);
  const instruments = useEquipmentStore((s) => s.instruments);
  const fieldOfView = useEquipmentStore((s) => s.fieldOfView);
  const sessions = useSessionStore((s) => s.sessions);
  const nights = useNightStore((s) => s.nights);
  const currentNightId = useNightStore((s) => s.currentNightId);
  const setCurrentNight = useNightStore((s) => s.setCurrentNight);
  const targets = useTargetStore((s) => s.targets);
  const windows = useMaintenanceStore((s) => s.windows);
  const rulings = useMaintenanceStore((s) => s.rulings);
  const sync = useMaintenanceStore((s) => s.sync);
  const readBulletin = useMaintenanceStore((s) => s.readBulletin);
  const registerWindow = useMaintenanceStore((s) => s.registerWindow);
  const cancelLocalWindow = useMaintenanceStore((s) => s.cancelLocalWindow);
  const upsertRuling = useMaintenanceStore((s) => s.upsertRuling);
  const withdrawRuling = useMaintenanceStore((s) => s.withdrawRuling);
  const { conflictsOfNight } = useConflictCheck();

  const [nightId, setNightId] = useState(currentNightId);
  const activeNightId = nightId || currentNightId;
  const night = nights.find((item) => item.id === activeNightId);
  const nightSessions = useMemo(() => sessions.filter((session) => session.nightId === activeNightId), [sessions, activeNightId]);
  const conflicts = useMemo(() => conflictsOfNight(activeNightId), [conflictsOfNight, activeNightId]);
  const maintenance = useMaintenanceConflicts(activeNightId);
  const slots = useMemo(() => Array.from({ length: NIGHT_TOTAL_MINUTES / SLOT_MINUTES }, (_, index) => index), []);

  const [bulletinBusy, setBulletinBusy] = useState(false);
  const [bulletinNotice, setBulletinNotice] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerForm, setRegisterForm] = useState<RegisterFormState>({
    telescopeId: '',
    date: night?.date ?? '',
    startTime: '20:00',
    endTime: '21:00',
    reason: '',
    registeredBy: '',
  });
  const [rulingOpen, setRulingOpen] = useState(false);
  const [rulingForm, setRulingForm] = useState<RulingFormState>({ conflictKey: '', verdict: '编排优先', dutyOfficer: night?.dutyOfficer ?? '', note: '' });

  const targetById = (id: string) => targets.find((target) => target.id === id);
  const telescopeById = (id: string) => telescopes.find((telescope) => telescope.id === id);
  const pairedInstrument = (telescopeCode: string) => instruments.find((instrument) => instrument.telescopeCode === telescopeCode);

  const nightWindows = useMemo(() => windows.filter((window) => window.date === night?.date), [windows, night?.date]);

  const conflictKeyOf = (conflict: MaintenanceConflict) => `${conflict.window.id}__${conflict.session.id}`;
  const findConflict = (key: string) =>
    maintenance.conflictsOfNight(activeNightId).find((conflict) => conflictKeyOf(conflict) === key);

  /** 某望远镜在某 30 分钟格子内的维修窗口（维护侧数据，只用于呈现与比对） */
  const maintenanceAt = (telescopeId: string, slot: number) => {
    const slotStart = slot * SLOT_MINUTES;
    const slotEnd = slotStart + SLOT_MINUTES;
    return nightWindows
      .filter((window) => window.telescopeId === telescopeId)
      .filter((window) => {
        const start = axisMinutes(window.startTime);
        const rawEnd = axisMinutes(window.endTime);
        const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
        return Math.min(end, slotEnd) - Math.max(start, slotStart) > 0;
      });
  };

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

  async function handleReadBulletin() {
    setBulletinBusy(true);
    setBulletinNotice('');
    const result = await readBulletin();
    setBulletinBusy(false);
    if (result.ok) {
      setBulletinNotice(
        `维护组通告对账成功，读入 ${result.imported} 条维修窗口；编排台排程段${result.sessionChanged ? '发生了变化（异常）' : '经指纹校验保持原样未动'}，重试只补了维护侧。`,
      );
    }
  }

  function openRegister() {
    setRegisterError('');
    setRegisterForm({
      telescopeId: telescopes[0]?.id ?? '',
      date: night?.date ?? nights[0]?.date ?? '',
      startTime: '20:00',
      endTime: '21:00',
      reason: '',
      registeredBy: '',
    });
    setRegisterOpen(true);
  }

  async function submitRegister() {
    if (!registerForm.telescopeId || !registerForm.date || !registerForm.reason.trim()) {
      setRegisterError('望远镜、日期与维护事项均为必填');
      return;
    }
    if (durationMinutes(registerForm.startTime, registerForm.endTime) <= 0) {
      setRegisterError('结束时刻必须晚于开始时刻（支持跨零点）');
      return;
    }
    await registerWindow(registerForm);
    setBulletinNotice(`维护组已登记 ${telescopeById(registerForm.telescopeId)?.code ?? ''} 在 ${registerForm.date} ${registerForm.startTime}-${registerForm.endTime} 的维修窗口，编排端不可修改`);
    setRegisterOpen(false);
  }

  async function handleCancelWindow(id: string) {
    try {
      await cancelLocalWindow(id);
      setBulletinNotice('已撤回本机登记的维修窗口');
    } catch (reason) {
      setBulletinNotice((reason as Error).message);
    }
  }

  function openRuling(conflict: MaintenanceConflict) {
    setRulingForm({
      conflictKey: conflictKeyOf(conflict),
      verdict: conflict.ruling?.verdict ?? '编排优先',
      dutyOfficer: conflict.ruling?.dutyOfficer ?? night?.dutyOfficer ?? '',
      note: conflict.ruling?.note ?? '',
    });
    setRulingOpen(true);
  }

  async function submitRuling() {
    const conflict = findConflict(rulingForm.conflictKey);
    if (!conflict) return;
    await upsertRuling({
      nightId: conflict.nightId,
      telescopeId: conflict.telescopeId,
      windowId: conflict.window.id,
      sessionId: conflict.session.id,
      verdict: rulingForm.verdict,
      dutyOfficer: rulingForm.dutyOfficer,
      note: rulingForm.note,
    });
    setRulingOpen(false);
    setBulletinNotice(`已记录值班人裁定：${rulingForm.verdict}（原始排程段与维修窗口均未被改写）`);
  }

  const contentionRows = [...maintenance.actionable, ...maintenance.ruled, ...maintenance.locked];

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        望远镜与终端分配视图
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        行 = 设备、列 = 30 分钟时段。编排台排程互撞标红；维护组维修窗口以橙色斜纹叠加，双方重叠的牵制格描紫边，由值班人在下方裁定——两边原始数据互不代改。
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
        <Chip
          size="small"
          color={maintenance.actionable.length ? 'secondary' : 'success'}
          variant={maintenance.actionable.length ? 'filled' : 'outlined'}
          label={`排程 × 维修牵制 ${maintenance.actionable.length} 项待裁定${maintenance.locked.length ? ` · ${maintenance.locked.length} 项已完成锁定` : ''}`}
        />
      </Stack>

      {/* 维护组通告对账卡片：对账失败只保留编排侧改动，重试只补维护侧 */}
      <Paper variant="outlined" sx={{ mb: 2, p: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
          <Typography variant="subtitle1">维护组通告对账</Typography>
          <Chip
            size="small"
            color={sync.status === '已读入' ? 'success' : sync.status === '读入失败' ? 'error' : 'default'}
            label={sync.status}
          />
          {sync.bulletinId ? <Chip size="small" variant="outlined" label={`通告期号 ${sync.bulletinId}`} /> : null}
          {sync.attempts > 0 ? <Chip size="small" variant="outlined" label={`已尝试 ${sync.attempts} 次`} /> : null}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          通告没读进来时，先留着编排台当天改过的排程；对账失败后重试只补维护组那一侧的维修窗口，排程段按指纹校验保持原样。
        </Typography>
        {sync.status === '读入失败' ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            <AlertTitle>对账失败（第 {sync.attempts} 次）</AlertTitle>
            {sync.lastError}
          </Alert>
        ) : null}
        {sync.status === '已读入' ? (
          <Alert severity="success" sx={{ mb: 1 }}>
            已于 {sync.succeededAt ? new Date(sync.succeededAt).toLocaleString('zh-CN', { hour12: false }) : '-'} 读入维护组通告（签发于{' '}
            {sync.bulletinIssuedAt ? new Date(sync.bulletinIssuedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}），通告窗口编排端只读。
          </Alert>
        ) : null}
        {bulletinNotice ? (
          <Alert severity={bulletinNotice.includes('不能') ? 'warning' : 'info'} sx={{ mb: 1 }} onClose={() => setBulletinNotice('')}>
            {bulletinNotice}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" color={sync.status === '读入失败' ? 'warning' : 'primary'} disabled={bulletinBusy} onClick={() => void handleReadBulletin()}>
            {bulletinBusy ? '对账中…' : sync.status === '读入失败' ? '重试读入（只补维护侧）' : sync.status === '已读入' ? '重新对账' : '读入维护组通告'}
          </Button>
          <Button variant="outlined" onClick={openRegister}>
            维护组本机登记窗口
          </Button>
        </Stack>
      </Paper>

      {/* 相互牵制区：摆到设备分配视图上等值班人裁定 */}
      <Paper variant="outlined" sx={{ mb: 2, p: 2, borderColor: maintenance.actionable.length ? 'secondary.main' : undefined }}>
        <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
          排程段 × 维修窗口相互牵制（值班人裁定台）
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          「编排优先」不会改写维修窗口，只是把排程段标记改期、由值班人去排程页挪到备用夜；「维护优先」维持停机。做完的段（已完成）不动，仅留痕。
        </Typography>
        {contentionRows.length === 0 ? (
          <Alert severity="success">本夜排程段与维护组停机时段无重叠，暂无相互牵制项。</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>望远镜</TableCell>
                <TableCell>排程段</TableCell>
                <TableCell>维修窗口</TableCell>
                <TableCell>重叠</TableCell>
                <TableCell>裁定</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {contentionRows.map((conflict) => {
                const key = conflictKeyOf(conflict);
                const target = targetById(conflict.session.targetId);
                return (
                  <TableRow key={key} hover sx={conflict.locked ? { bgcolor: 'action.hover' } : undefined}>
                    <TableCell>
                      <Stack spacing={0.25}>
                        <Typography variant="body2">{telescopeById(conflict.telescopeId)?.code ?? conflict.telescopeId}</Typography>
                        {conflict.locked ? <Chip size="small" color="default" label="已完成段·锁定" /> : null}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {conflict.session.startTime}-{conflict.session.endTime} {target?.name ?? ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {conflict.session.id} · {conflict.session.status}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {conflict.window.startTime}-{conflict.window.endTime} {conflict.window.reason}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {conflict.window.source === 'bulletin' ? '维护组通告' : '本机登记'} · {conflict.window.registeredBy}
                      </Typography>
                    </TableCell>
                    <TableCell>{conflict.overlapText}</TableCell>
                    <TableCell>
                      {conflict.ruling ? (
                        <Stack spacing={0.25}>
                          <Chip size="small" color={conflict.ruling.verdict === '维护优先' ? 'warning' : 'info'} label={conflict.ruling.verdict} />
                          <Typography variant="caption" color="text.secondary">
                            {conflict.ruling.dutyOfficer}
                            {conflict.ruling.note ? `：${conflict.ruling.note}` : ''}
                          </Typography>
                        </Stack>
                      ) : (
                        <Chip size="small" color="secondary" label="待裁定" />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {conflict.locked ? (
                        <Tooltip title="排程段已执行完毕，做完的段不动，仅维持维护方安排并留痕">
                          <span>
                            <Button size="small" disabled>
                              不可改期
                            </Button>
                          </span>
                        </Tooltip>
                      ) : (
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Button size="small" color="secondary" onClick={() => openRuling(conflict)}>
                            {conflict.ruling ? '改裁定' : '裁定'}
                          </Button>
                          {conflict.ruling?.verdict === '编排优先' ? (
                            <Button size="small" onClick={() => navigate(`/sessions?highlight=${conflict.session.id}&night=${activeNightId}`)}>
                              去改期
                            </Button>
                          ) : null}
                          {conflict.ruling ? (
                            <Button size="small" color="error" onClick={() => void withdrawRuling(conflict.ruling!.id)}>
                              撤裁定
                            </Button>
                          ) : null}
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>

      {conflicts.length > 0 ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          本夜存在 {conflicts.length} 处编排台排程互撞（同一望远镜同时段多段），冲突格已标红：{' '}
          {conflicts.map((conflict) => `${conflict.sessionId}↔${conflict.otherId}（${conflict.overlapText}）`).join('；')}
        </Alert>
      ) : (
        <Alert severity="success" sx={{ mb: 2 }}>
          本夜各望远镜排程段时段无重叠，无设备互撞
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
        <Chip size="small" sx={{ bgcolor: TARGET_COLOR['星云'], color: '#fff' }} label="排程段占用" />
        <Chip size="small" sx={{ bgcolor: '#f9a825', color: '#3e2723' }} label="维修窗口（斜纹）" />
        <Chip size="small" color="error" label="排程互撞" />
        <Chip size="small" color="secondary" label="排程 × 维修牵制（紫边）" />
      </Stack>

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
                    const windowItems = maintenanceAt(telescope.id, slot);
                    const isSessionClash = items.length > 1;
                    const slotContention = maintenance.cellConflicts(activeNightId, telescope.id, slot, SLOT_MINUTES);
                    const hasContention = slotContention.length > 0;
                    const target = items[0] ? targetById(items[0].targetId) : undefined;
                    const sessionClash = isSessionClash;
                    const baseBg = sessionClash ? 'error.main' : items.length === 1 ? TARGET_COLOR[target?.type ?? '星云'] : windowItems.length ? '#fff8e1' : 'transparent';
                    return (
                      <TableCell
                        key={slot}
                        align="center"
                        sx={{
                          px: 0.25,
                          py: 0.5,
                          bgcolor: baseBg,
                          backgroundImage: windowItems.length
                            ? 'repeating-linear-gradient(45deg, rgba(249,168,37,.45) 0 5px, rgba(249,168,37,.15) 5px 10px)'
                            : undefined,
                          color: items.length ? '#fff' : windowItems.length ? '#3e2723' : 'text.secondary',
                          cursor: items.length ? 'pointer' : 'default',
                          borderLeft: '1px solid',
                          borderColor: 'divider',
                          outline: hasContention ? '2px solid #7c52d3' : undefined,
                          outlineOffset: -2,
                        }}
                        onClick={() => {
                          if (items.length === 0) return;
                          navigate(`/sessions?highlight=${items[0].id}&night=${activeNightId}`);
                        }}
                      >
                        {items.length === 0 && windowItems.length === 0 ? (
                          <Typography variant="caption">·</Typography>
                        ) : sessionClash ? (
                          <Tooltip title={items.map((item) => `${item.startTime}-${item.endTime} ${targetById(item.targetId)?.name ?? ''}`).join(' ｜ ')}>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: '#fff' }}>
                              互撞 {items.length}
                            </Typography>
                          </Tooltip>
                        ) : hasContention ? (
                          <Tooltip
                            title={
                              <Box>
                                {slotContention.map((conflict) => (
                                  <div key={conflictKeyOf(conflict)}>
                                    牵制：{conflict.session.startTime}-{conflict.session.endTime} {targetById(conflict.session.targetId)?.name ?? ''} ⨯ 维护{' '}
                                    {conflict.window.startTime}-{conflict.window.endTime}（{conflict.window.reason}）{conflict.locked ? ' · 已完成锁定' : ''}
                                  </div>
                                ))}
                              </Box>
                            }
                          >
                            <Typography variant="caption" sx={{ fontWeight: 700, color: items.length ? '#fff' : '#4a2a8f' }}>
                              牵制{items.length ? `·${target?.name ?? '排程'}` : ''}
                            </Typography>
                          </Tooltip>
                        ) : windowItems.length ? (
                          <Tooltip title={windowItems.map((window) => `维护 ${window.startTime}-${window.endTime}：${window.reason}（${window.registeredBy}）`).join(' ｜ ')}>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              {items.length ? target?.name ?? '已排' : '维护'}
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Tooltip title={`${items[0].startTime}-${items[0].endTime} ${target?.name ?? ''} · ${items[0].status}`}>
                            <Typography variant="caption" sx={{ whiteSpace: 'nowrap', color: '#fff' }}>
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

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        维护组维修窗口（{nightWindows.length}）
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>望远镜</TableCell>
              <TableCell>时段</TableCell>
              <TableCell>维护事项</TableCell>
              <TableCell>登记人</TableCell>
              <TableCell>来源</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {nightWindows.map((window) => (
              <TableRow key={window.id} hover>
                <TableCell>{telescopeById(window.telescopeId)?.code ?? window.telescopeId}</TableCell>
                <TableCell>{`${window.startTime}-${window.endTime}`}</TableCell>
                <TableCell>{window.reason}</TableCell>
                <TableCell>{window.registeredBy}</TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" color={window.source === 'bulletin' ? 'warning' : 'default'} label={window.source === 'bulletin' ? '维护组通告（只读）' : '本机登记'} />
                </TableCell>
                <TableCell align="right">
                  {window.source === 'local' ? (
                    <Button size="small" color="error" onClick={() => void handleCancelWindow(window.id)}>
                      撤回登记
                    </Button>
                  ) : (
                    <Tooltip title="通告窗口由维护组签发，编排端不能改也不能抹">
                      <span>
                        <Button size="small" disabled>
                          只读
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {nightWindows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="caption" color="text.secondary">
                    本夜尚无维修窗口；请先读入维护组通告，或由维护组本机登记。
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <Divider sx={{ mb: 2 }} />

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

      <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
        <Button variant="outlined" onClick={() => navigate('/sessions')}>
          前往排程段列表处理互撞
        </Button>
        {rulings.length > 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            全观测夜累计 {rulings.length} 条值班裁定（仅作裁定留痕，不回写任一方原始数据）
          </Typography>
        ) : null}
      </Box>

      {/* 维护组本机登记窗口 */}
      <Dialog open={registerOpen} onClose={() => setRegisterOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>维护组本机登记维修窗口</DialogTitle>
        <DialogContent>
          {registerError ? (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {registerError}
            </Alert>
          ) : null}
          <Alert severity="info" sx={{ mb: 1.5 }}>
            登记后该望远镜在所选时段标记停机，编排端可见但不能改；日期按观测夜对齐（18:00 起算，可跨零点到次日凌晨）。
          </Alert>
          <FieldRow label="望远镜" required>
            <TextField select size="small" fullWidth value={registerForm.telescopeId} onChange={(event) => setRegisterForm({ ...registerForm, telescopeId: event.target.value })}>
              {telescopes.map((telescope) => (
                <MenuItem key={telescope.id} value={telescope.id}>
                  {`${telescope.code} · ${telescope.status}`}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="日期（观测夜）" required hint="与观测夜日期一致，例如 2025-10-11 覆盖该日 18:00 → 次日 06:00">
            <TextField size="small" type="date" fullWidth value={registerForm.date} onChange={(event) => setRegisterForm({ ...registerForm, date: event.target.value })} />
          </FieldRow>
          <FieldRow label="开始时刻" required>
            <TextField size="small" fullWidth value={registerForm.startTime} onChange={(event) => setRegisterForm({ ...registerForm, startTime: event.target.value })} placeholder="20:00" />
          </FieldRow>
          <FieldRow label="结束时刻" required hint="格式 HH:mm，可跨零点">
            <TextField size="small" fullWidth value={registerForm.endTime} onChange={(event) => setRegisterForm({ ...registerForm, endTime: event.target.value })} placeholder="22:00" />
          </FieldRow>
          <FieldRow label="维护事项" required>
            <TextField size="small" fullWidth value={registerForm.reason} onChange={(event) => setRegisterForm({ ...registerForm, reason: event.target.value })} placeholder="例如：赤道仪保养" />
          </FieldRow>
          <FieldRow label="登记人" required>
            <TextField size="small" fullWidth value={registerForm.registeredBy} onChange={(event) => setRegisterForm({ ...registerForm, registeredBy: event.target.value })} placeholder="维护组值班姓名" />
          </FieldRow>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRegisterOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => void submitRegister()}>
            登记停机
          </Button>
        </DialogActions>
      </Dialog>

      {/* 值班人裁定 */}
      <Dialog open={rulingOpen} onClose={() => setRulingOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>值班人裁定相互牵制</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            裁定只记录值班人的决定，不会替任何一方改数据：选「编排优先」后请到排程页把该段改期到备用夜；维修窗口始终原样保留。
          </Alert>
          <FieldRow label="裁定结果" required>
            <TextField select size="small" fullWidth value={rulingForm.verdict} onChange={(event) => setRulingForm({ ...rulingForm, verdict: event.target.value as RulingVerdict })}>
              {RULING_VERDICTS.map((verdict) => (
                <MenuItem key={verdict} value={verdict}>
                  {verdict}
                  {verdict === '维护优先' ? '（维持停机，排程段自行避让）' : '（排程段改期到备用夜，维修窗口不动）'}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="值班人" required>
            <TextField size="small" fullWidth value={rulingForm.dutyOfficer} onChange={(event) => setRulingForm({ ...rulingForm, dutyOfficer: event.target.value })} />
          </FieldRow>
          <FieldRow label="裁定说明">
            <TextField size="small" fullWidth multiline minRows={2} value={rulingForm.note} onChange={(event) => setRulingForm({ ...rulingForm, note: event.target.value })} />
          </FieldRow>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRulingOpen(false)}>取消</Button>
          <Button variant="contained" color="secondary" onClick={() => void submitRuling()}>
            确认裁定
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
