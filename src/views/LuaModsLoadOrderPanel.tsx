import * as React from 'react';
import { useSelector } from 'react-redux';
import LuaModsLoadOrderEntry from './LuaModsLoadOrderEntry';
import { types, selectors, EmptyPlaceholder } from 'vortex-api';

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

function LuaModsLoadOrderPanel() {
    const profile = useSelector((state: types.IState) => selectors.activeProfile(state));
    const luaMods = useSelector((state: IStateWithLuaLoadOrder) => state.session.lualoadorder?.[profile.id] || {});

    // Show mods in load-order (their index in mods.txt), stable regardless of object key order.
    const folderNames = Object.keys(luaMods)
        .sort((a, b) => (luaMods[a]?.index ?? 0) - (luaMods[b]?.index ?? 0));
    const enabledCount = folderNames.filter(f => luaMods[f]?.enabled).length;

    if (!folderNames.length) {
        return (
            <div className='panel panel-default etb-luamods-panel'>
                <EmptyPlaceholder
                    icon='highlight-lab'
                    text='No Lua mods installed'
                    subtext='Install a Lua or Blueprint mod, then press Refresh to see it here.'
                    fill
                />
            </div>
        );
    }

    return (
        <div className='panel panel-default etb-luamods-panel'>
            <div className='panel-heading etb-luamods-header'>
                <span className='etb-luamods-title'>Lua Mods</span>
                <span className='badge etb-luamods-count'>{enabledCount} / {folderNames.length} enabled</span>
            </div>
            <div className='list-group etb-luamods-list'>
                {folderNames.map((folderName: string) =>
                    <LuaModsLoadOrderEntry key={folderName} folderName={folderName} />)}
            </div>
        </div>
    );
}

export default LuaModsLoadOrderPanel;
