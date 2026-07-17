import * as React from 'react';
import { useSelector } from 'react-redux';
import { MainPage, IconBar, ToolbarIcon, FlexLayout, MainContext, types, selectors } from 'vortex-api';
import { refreshLuaMods, openLuaModsFolder } from '../util/luaModsUtil';
import LuaModsLoadOrderInfo from './LuaModsLoadOrderInfo';
import LuaModsLoadOrderPanel from './LuaModsLoadOrderPanel';

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

function LuaModsLoadOrderPage(): React.JSX.Element {
    const context: types.IExtensionContext = React.useContext(MainContext) as unknown as types.IExtensionContext;
    const profile = useSelector((state: types.IState) => selectors.activeProfile(state));
    const luaMods = useSelector((state: IStateWithLuaLoadOrder) => state.session.lualoadorder?.[profile.id] || {});

    const toolbar = [
        {
            component: ToolbarIcon,
            props: () => {
                return {
                    id: 'btn-refresh-logic-mods',
                    key: 'btn-refresh-logic-mods',
                    icon: 'refresh',
                    text: 'Refresh',
                    onClick: () => refreshLuaMods(context.api),
                    tooltip: 'Reload the list of available Lua Mods'
                }
            }
        },
        {
            component: ToolbarIcon,
            props: () => {
                return {
                    id: 'btn-browse-logic-mods',
                    key: 'btn-browse-logic-mods',
                    icon: 'open-ext',
                    text: 'Open Folder',
                    onClick: () => openLuaModsFolder(context.api),
                    disabled: (Object.keys(luaMods).length === 0),
                    tooltip: 'Open Lua Mods folder'
                }
            }
        }
    ]

    return (
        <MainPage>
            <MainPage.Header>
                <IconBar
                    t={null}
                    group='logic-mods-icons'
                    staticElements={toolbar}
                    className='menubar'
                />
            </MainPage.Header>
            <MainPage.Body>
                <FlexLayout type='row' className='etb-luamods-layout'>
                    <FlexLayout.Flex className='etb-luamods-main'>
                        <LuaModsLoadOrderPanel/>
                    </FlexLayout.Flex>
                    <FlexLayout.Fixed className='etb-luamods-side'>
                        <LuaModsLoadOrderInfo/>
                    </FlexLayout.Fixed>
                </FlexLayout>
            </MainPage.Body>
        </MainPage>
    );
};



export default LuaModsLoadOrderPage;
