import * as React from 'react';
import { Toggle } from 'vortex-api';
import { useDispatch, useSelector } from 'react-redux';
import { types, selectors } from 'vortex-api';
import { setLuaModStatus } from '../actions/luaActions';

interface IProps {
    folderName: string;
}

interface IStateWithLuaLoadOrder {
    session: {
        lualoadorder?: {
            [key: string]: {
                [key: string] : {
                    enabled: boolean;
                    index?: number;
                }
            }
        }
    }
}

function LuaModsLoadOrderEntry(props: IProps) {
    const { folderName } = props;
    const profile = useSelector((state: types.IState) => selectors.activeProfile(state));
    const entry = useSelector((state: IStateWithLuaLoadOrder) => state.session.lualoadorder?.[profile.id]?.[folderName]);
    const dispatch = useDispatch();
    const setStatus = (enabled: boolean) => dispatch(setLuaModStatus(profile.id, folderName, enabled));

    if (!entry) return null;

    return (
        <div className={`list-group-item etb-luamod-entry${entry.enabled ? '' : ' is-disabled'}`}>
            <Toggle
                checked={entry.enabled}
                onToggle={(e) => setStatus(e.valueOf())}
            >
                <span className='etb-luamod-name' title={folderName}>{folderName}</span>
            </Toggle>
            <span className='etb-luamod-status'>{entry.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
    );
}

export default LuaModsLoadOrderEntry;
